#!/usr/bin/env python3
"""Private volleyball Telegram bot. Python 3.12+ with aiogram 3.31.0.

Run: python3 bot.py --help. Secrets are read from the environment/BOT_ENV_FILE.
Business state lives exclusively in a private GitHub data branch.
"""
from __future__ import annotations
import argparse
import base64
import concurrent.futures
import copy
import csv
import hashlib
import hmac
import io
import json
import logging
import os
from pathlib import Path
import re
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time as daytime, timedelta, timezone
from zoneinfo import ZoneInfo

MSK = ZoneInfo("Europe/Moscow")
UTC = timezone.utc
LABELS = {"MSSI":"МССИ", "LVL":"ЛВЛ", "CHM":"ЧМ", "LCHB":"ЛЧБ", "TRAINING":"Тренировки"}
SECTIONS = {
    "state/users.json":"users", "state/subscriptions.json":"subscriptions",
    "state/events.json":"events", "state/participation.json":"participation",
    "state/notifications.json":"notifications", "state/processed-updates.json":"processedUpdates",
    "state/source-state.json":"sourceState", "state/operations.json":"operations",
}
MANIFEST = ("schemaVersion", "stateVersion", "runtime", "archives", "lastArchiveAt",
            "archivedEvents", "pollOffset", "lease", "lastSyncAt")
OWN_BOOK = "1qoniSvNsRrRpxPycM8vqMcZq7gvO7lcGLYdjrEz0L3k"
SOURCES = [
    {"scope":"MSSI","book":OWN_BOOK,"gid":829855182},
    {"scope":"LVL","book":OWN_BOOK,"gid":11476290},
    {"scope":"LCHB","book":OWN_BOOK,"gid":543095078},
    {"scope":"CHM","book":"1WKhrg8yCAgbkB1bBg7XPv78H1z772IesmB8aKJYBh_Q","gid":2047287896,"season":"2026/2027"},
]
WEEKDAYS = ("понедельник","вторник","среда","четверг","пятница","суббота","воскресенье")
STATUSES = {"":"scheduled","В расписании":"scheduled","Перенос":"postponed","Отменена":"cancelled","Сыграна":"played"}
LOG = logging.getLogger("volley")

def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",",":"), allow_nan=False)

def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z","+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include its timezone")
    return parsed.astimezone(UTC)

def iso(value):
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00","Z")

def now_utc():
    return iso(datetime.now(UTC))

def clean(value):
    return " ".join(str(value or "").split())

def normalized(value):
    return clean(value).casefold().replace("ё","е")

def full_date(value):
    value = clean(value)
    if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", value):
        return datetime.strptime(value,"%d.%m.%Y").date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
        raise ValueError("Date must include the year")
    return date.fromisoformat(value).isoformat()

def start_time(day, clock):
    if not clock:
        return None
    if not re.fullmatch(r"\d{1,2}:\d{2}(?::00)?",clock):
        raise ValueError("Invalid match time")
    hour, minute = map(int,clock.split(":")[:2])
    return iso(datetime.combine(date.fromisoformat(day),daytime(hour,minute),MSK))

def event_instant(event):
    return instant(event["startAtUtc"]) if event.get("startAtUtc") else datetime.combine(
        date.fromisoformat(event["localDate"]),daytime(12,0),MSK).astimezone(UTC)

def upcoming(event, now):
    return event["status"] in ("scheduled","postponed") and event_instant(event) > instant(now)

def new_event(eid, scope, day, clock, opponent, venue="", status="scheduled"):
    return dict(eventId=eid, sourceKey=scope, scope=scope, kind="game",
                team="Росэнергоатом" if scope=="LCHB" else "Сеченовский университет",
                opponent=opponent, localDate=day, startAtUtc=start_time(day,clock),
                venue=venue, status=status, revision=1, attendanceRevision=1)

def normalize_own(text, scope):
    if scope not in ("MSSI","LVL","LCHB"):
        raise ValueError("Unknown own-sheet scope")
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff")),strict=True))
    if len(rows)<5 or not rows[4] or normalized(rows[4][0])!="id игры":
        raise ValueError("Schedule header changed")
    found, seen = [], set()
    for raw in rows[5:]:
        row = [clean(raw[i] if i<len(raw) else "") for i in range(6)]
        if not any(row):
            continue
        eid, day, clock, opponent, venue, status = row
        if not re.fullmatch(re.escape(scope)+r"-[A-Za-z0-9-]{1,30}",eid) or eid in seen:
            raise ValueError("Invalid or duplicate event ID")
        if not opponent or len(opponent)>300 or len(venue)>500 or status not in STATUSES:
            raise ValueError("Invalid opponent, venue or status")
        seen.add(eid)
        found.append(new_event(eid,scope,full_date(day),clock,opponent,venue,STATUSES[status]))
    return sorted(found,key=lambda e:e["eventId"])

def chm_date(raw, first, last):
    if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}",raw):
        return full_date(raw)
    months = ("января","февраля","марта","апреля","мая","июня",
              "июля","августа","сентября","октября","ноября","декабря")
    dotted = re.fullmatch(r"(\d{1,2})\.(\d{1,2})",raw)
    words = re.fullmatch(r"(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?",raw.casefold())
    if dotted:
        day, month = map(int,dotted.groups()); year = first if month>=7 else last
    elif words and words[2] in months:
        day, month = int(words[1]), months.index(words[2])+1
        year = int(words[3]) if words[3] else first if month>=7 else last
    else:
        raise ValueError("Invalid championship date")
    return date(year,month,day).isoformat()

def normalize_chm(text, season):
    match = re.fullmatch(r"(20\d{2})\s*[/-]\s*((?:20)?\d{2})",season)
    if not match:
        raise ValueError("Championship season is required")
    first, last = int(match[1]), int(match[2] if len(match[2])==4 else "20"+match[2])
    if last!=first+1:
        raise ValueError("Invalid season")
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff")),strict=True))
    if not any(len(row)>=19 and row[0].strip().isdigit() for row in rows):
        raise ValueError("Championship table structure changed")
    found, seen = [], set()
    for raw in rows:
        row = [clean(raw[i] if i<len(raw) else "") for i in range(19)]
        home, away = row[8], row[18]
        if normalized(home)!="сеченовский университет" and normalized(away)!="сеченовский университет":
            continue
        if not re.fullmatch(r"\d{1,12}",row[0]):
            raise ValueError("Invalid championship game number")
        eid = f"CHM-{first}-{last}-{row[0]}"
        if eid in seen:
            raise ValueError("Duplicate championship game")
        seen.add(eid)
        day = chm_date(row[5] or row[4],first,last)
        found.append(new_event(eid,"CHM",day,row[6],
            away if normalized(home)=="сеченовский университет" else home,
            row[7],"postponed" if row[5] else "scheduled"))
    return sorted(found,key=lambda e:e["eventId"])

def empty_state(runtime_id="server-primary", epoch=1):
    state = dict(schemaVersion=1,stateVersion=0,runtime={"id":runtime_id,"epoch":epoch,"paused":True},
                 archives=[],archivedEvents={},pollOffset=0,lease=None)
    for key in SECTIONS.values():
        state[key]=[] if key=="operations" else {}
    return state

def audit(state, action, now, actor=None, target=None, previous=None, next_value=None, opid=None):
    state["operations"].append(dict(operationId=opid or f"{action}:{target}:{now}:{len(state['operations'])}",
        actorId=actor, action=action, targetId=target, at=now, result="ok",
        previous=copy.deepcopy(previous), next=copy.deepcopy(next_value)))

def synchronize(state, snapshots, now):
    for snap in snapshots:
        source = snap["sourceId"]
        prior = copy.deepcopy(state["sourceState"].get(source,{}))
        old_events = [e for e in state["events"].values() if e["sourceKey"]==source]
        incoming = snap.get("events",[])
        seen = {e["eventId"] for e in incoming}
        error = None if snap.get("ok") else snap.get("error","Источник недоступен")
        if len(seen)!=len(incoming) or any(e["sourceKey"]!=source for e in incoming):
            error="Некорректные ID источника"
        if snap.get("ok") and not incoming and any(e["status"]!="removed" for e in old_events):
            error="Пустой источник требует проверки"
        if error:
            state["sourceState"][source]={**prior,"lastError":error,"missing":prior.get("missing",{})}
            if prior.get("lastError")!=error:
                audit(state,"SOURCE_ERROR",now,target=source,previous=prior.get("lastError"),next_value=error)
            continue
        first = not prior.get("lastSuccessAt")
        missing = prior.get("missing",{})
        changed = False
        for source_event in incoming:
            eid=source_event["eventId"]; old=state["events"].get(eid)
            if old and old["sourceKey"]!=source:
                raise ValueError("Event ID belongs to another source")
            missing[eid]=0
            if not old:
                tombstone=state.get("archivedEvents",{}).get(eid)
                if tombstone and not upcoming(source_event,now):
                    continue
                added=copy.deepcopy(source_event)
                if tombstone:
                    added.update(revision=tombstone["revision"]+1,attendanceRevision=tombstone["attendanceRevision"]+1)
                    del state["archivedEvents"][eid]
                state["events"][eid]=added
                if not first:
                    audit(state,"EVENT_CHANGED",now,target=eid,next_value=added)
                changed=True
                continue
            fields=("localDate","startAtUtc","opponent","venue","status","team")
            if not any(old.get(k)!=source_event.get(k) for k in fields):
                continue
            reconfirm=any(old.get(k)!=source_event.get(k) for k in fields[:4]) or (
                old["status"] in ("removed","cancelled") and source_event["status"] not in ("removed","cancelled"))
            updated={**copy.deepcopy(source_event),"revision":old["revision"]+1,
                     "attendanceRevision":old["attendanceRevision"]+int(reconfirm)}
            state["events"][eid]=updated
            audit(state,"EVENT_CHANGED",now,target=eid,previous=old,next_value=updated)
            changed=True
        for old in old_events:
            eid=old["eventId"]
            if eid in seen or old["status"]=="removed" or source=="TRAINING":
                continue
            missing[eid]=missing.get(eid,0)+1
            if missing[eid]>=2:
                updated={**old,"status":"removed","revision":old["revision"]+1}
                state["events"][eid]=updated
                audit(state,"EVENT_CHANGED",now,target=eid,previous=old,next_value=updated)
                changed=True
        heartbeat=not prior.get("lastSuccessAt") or instant(now)-instant(prior["lastSuccessAt"])>=timedelta(minutes=15)
        state["sourceState"][source]={"missing":missing,"lastSuccessAt":now if heartbeat or changed or prior.get("lastError") else prior["lastSuccessAt"]}
        if prior.get("lastError"):
            audit(state,"SOURCE_RESTORED",now,target=source,previous=prior["lastError"])

def generate_trainings(state, now):
    today=instant(now).astimezone(MSK).date()
    for offset in range(56):
        day=today+timedelta(days=offset)
        if day.weekday() not in (0,3):
            continue
        eid="TRAINING-"+day.isoformat()
        if eid in state["events"] or eid in state.get("archivedEvents",{}):
            continue
        e=new_event(eid,"TRAINING",day.isoformat(),"19:30","","Буревестник")
        e["kind"]="training"
        state["events"][eid]=e

def event_card(event, now):
    day=date.fromisoformat(event["localDate"])
    delta=(day-instant(now).astimezone(MSK).date()).days
    countdown="сегодня" if delta==0 else "завтра" if delta==1 else f"через {delta} дн." if delta>1 else f"{-delta} дн. назад"
    title="🏐 Тренировка" if event["kind"]=="training" else f"{LABELS[event['scope']]} · {event['team']} — {event['opponent']}"
    clock=instant(event["startAtUtc"]).astimezone(MSK).strftime("%H:%M")+" МСК" if event.get("startAtUtc") else "Время пока не указано"
    suffix={"cancelled":"\n❌ Отменено","removed":"\nСнято из расписания","played":"\nСыграно","postponed":"\nПеренесено"}.get(event["status"],"")
    return f"{title}\n{WEEKDAYS[day.weekday()]}, {day:%d.%m.%y} · {countdown}\n{clock}\nМесто: {event.get('venue') or 'пока не указано'}{suffix}"

def attendance_buttons(event):
    eid, revision=event["eventId"], event["attendanceRevision"]
    return [[{"text":"✅ Буду","data":f"r|{eid}|{revision}|y"},{"text":"❌ Не буду","data":f"r|{eid}|{revision}|n"}]]

def subscribed(state, uid, scope):
    u=state["users"].get(uid,{})
    return u.get("accessStatus")=="approved" and scope in state["subscriptions"].get(uid,[])

def event_stats(state, eid):
    event=state["events"][eid]
    result={k:[] for k in ("yes","no","unanswered","reconfirm")}
    for uid,u in state["users"].items():
        if not subscribed(state,uid,event["scope"]):
            continue
        p=state["participation"].get(eid+":"+uid,{})
        key="reconfirm" if p.get("answer") and p.get("attendanceRevision")!=event["attendanceRevision"] else p.get("answer") or "unanswered"
        result[key].append(u)
    for values in result.values():
        values.sort(key=lambda u:u["fullName"].casefold())
    return result

def can_deliver(state, notice, now):
    uid=notice["userId"]; user=state["users"].get(uid)
    if not user or user.get("deliveryStatus")=="blocked":
        return False
    eid=notice.get("eventId")
    if not eid:
        return True
    e=state["events"].get(eid)
    if not e or not subscribed(state,uid,e["scope"]) or notice["revision"]!=e["revision"]:
        return False
    if "followup" in notice.get("fulfills",[notice["type"]]):
        p=state["participation"].get(eid+":"+uid,{})
        if p.get("answer") and p.get("attendanceRevision")==e["attendanceRevision"] and notice["type"]=="followup":
            return False
    return notice["type"]=="change" or upcoming(e,now)

def has_notice(state, event, uid, kind):
    return any(n.get("eventId")==event["eventId"] and n["userId"]==uid
        and n.get("attendanceRevision")==event["attendanceRevision"]
        and (n["status"]!="cancelled" or n.get("terminal"))
        and kind in n.get("fulfills",[n["type"]]) for n in state["notifications"].values())

def make_notice(state, event, uid, kinds, title, now, due=None, old=None):
    eid, revision=event["eventId"], event["attendanceRevision"]
    tail="change-"+str(event["revision"]) if "change" in kinds else "+".join(sorted(kinds))
    key=f"notice:{eid}:{revision}:{uid}:{tail}"
    existing=state["notifications"].get(key)
    if existing and (existing["status"]!="cancelled" or existing.get("terminal")):
        return
    if "poll" in kinds:
        pk=eid+":"+uid
        p=state["participation"].setdefault(pk,dict(eventId=eid,telegramUserId=uid,attendanceRevision=revision,
            answer=None,invitedAt=now,firstPollSentAt=None,answeredAt=None,answerSource=None))
        if p.get("pollRevision")!=revision:
            p.update(pollRevision=revision,firstPollSentAt=None)
    text=title+"\n\n"+event_card(event,now)
    if old:
        text=title+"\n\nБыло:\n"+event_card(old,now)+"\n\nСтало:\n"+event_card(event,now)
    source=state["sourceState"].get(event["sourceKey"],{})
    if source.get("lastError"):
        text+="\n⚠️ Источник недоступен. Последняя проверка: "+source.get("lastSuccessAt","не завершена")
    kind="change" if "change" in kinds else "day" if "day" in kinds else "followup" if "followup" in kinds else "poll"
    message={"chatId":state["users"][uid]["privateChatId"],"text":text}
    if upcoming(event,now):
        message["buttons"]=attendance_buttons(event)
    state["notifications"][key]=dict(notificationId=key,eventId=eid,userId=uid,scope=event["scope"],
        revision=event["revision"],attendanceRevision=revision,type=kind,fulfills=kinds,dueAt=due or now,
        status="pending",attempts=0,message=message)

def plan_notifications(state, now):
    clock=instant(now)
    for n in state["notifications"].values():
        if n["status"] in ("pending","retry") and not can_deliver(state,n,now):
            n["status"]="cancelled"
    changes={}
    for op in state["operations"]:
        if op["action"]=="EVENT_CHANGED":
            changes[op["targetId"]]=op
        if op["action"] in ("SOURCE_ERROR","SOURCE_RESTORED"):
            for uid,u in state["users"].items():
                if u["role"]=="owner" and u["accessStatus"]=="approved":
                    key="health:"+op["operationId"]+":"+uid
                    if key not in state["notifications"]:
                        queue_dialog(state,uid,("⚠️ Ошибка источника " if op["action"]=="SOURCE_ERROR" else "✅ Источник восстановлен ")+op["targetId"],now,key=key)
    for eid,op in changes.items():
        e=state["events"].get(eid); old=op.get("previous")
        if not e or not (upcoming(e,now) or (old and upcoming(old,now))):
            continue
        for uid in state["users"]:
            if not subscribed(state,uid,e["scope"]) or state["users"][uid]["deliveryStatus"]=="blocked":
                continue
            if any(n.get("eventId")==eid and n["userId"]==uid and n.get("revision")==e["revision"]
                   and "change" in n.get("fulfills",[]) and (n["status"]!="cancelled" or n.get("terminal")) for n in state["notifications"].values()):
                continue
            kinds=["change"]; distance=event_instant(e)-clock
            if upcoming(e,now) and distance<=timedelta(days=7) and not has_notice(state,e,uid,"poll"):
                kinds.append("poll")
            if upcoming(e,now) and distance<=timedelta(days=1) and not has_notice(state,e,uid,"day"):
                kinds.append("day")
            title={"cancelled":"❌ Событие отменено.","removed":"Событие снято из расписания."}.get(e["status"],"🔄 Расписание изменилось." if old else "Добавлено событие.")
            if "poll" in kinds:
                title+=" Подтвердите участие."
            make_notice(state,e,uid,kinds,title,now,old=old)
    for e in state["events"].values():
        if not upcoming(e,now):
            continue
        start=event_instant(e)
        for uid in state["users"]:
            if not subscribed(state,uid,e["scope"]) or state["users"][uid]["deliveryStatus"]=="blocked":
                continue
            p=state["participation"].get(e["eventId"]+":"+uid,{})
            kinds=[]
            if clock>=start-timedelta(days=7) and not has_notice(state,e,uid,"poll"):
                kinds.append("poll")
            if clock>=start-timedelta(days=1) and not has_notice(state,e,uid,"day"):
                kinds.append("day")
            if (not p.get("answer") or p.get("attendanceRevision")!=e["attendanceRevision"]) and p.get("pollRevision")==e["attendanceRevision"] and p.get("firstPollSentAt") and clock>=instant(p["firstPollSentAt"])+timedelta(days=1) and not has_notice(state,e,uid,"followup"):
                kinds.append("followup")
            if not kinds:
                continue
            title="⏰ Напоминание о ближайшем событии" if "day" in kinds else "Вы ещё не ответили. Будете?" if "followup" in kinds else "Будете участвовать?"
            due=start-timedelta(days=1) if "day" in kinds else instant(p["firstPollSentAt"])+timedelta(days=1) if "followup" in kinds else start-timedelta(days=7)
            make_notice(state,e,uid,kinds,title,now,iso(due))

def archive_state(state, now):
    cutoff=(instant(now).astimezone(MSK).date()-timedelta(days=90)).isoformat()
    groups={}
    def move(month,section,key,value):
        groups.setdefault(month,{}).setdefault(section,{})[key]=value
    old={}
    for eid,e in list(state["events"].items()):
        unresolved=any(n.get("eventId")==eid and n["status"] in ("pending","retry","sending","uncertain") for n in state["notifications"].values())
        if e["localDate"]<cutoff and not unresolved:
            old[eid]=e
            state.setdefault("archivedEvents",{})[eid]={"revision":e["revision"],"attendanceRevision":e["attendanceRevision"]}
            move(e["localDate"][:7],"events",eid,e)
            del state["events"][eid]
    for key,p in list(state["participation"].items()):
        if p["eventId"] in old:
            move(old[p["eventId"]]["localDate"][:7],"participation",key,p)
            del state["participation"][key]
    for key,n in list(state["notifications"].items()):
        if n.get("eventId") in old or (n["status"] in ("sent","cancelled") and n["dueAt"][:10]<cutoff):
            month=old[n["eventId"]]["localDate"][:7] if n.get("eventId") in old else n["dueAt"][:7]
            move(month,"notifications",key,n); del state["notifications"][key]
    kept=[]
    for op in state["operations"]:
        if op["at"][:10]<cutoff:
            move(op["at"][:7],"operations",op["operationId"],op)
        else:
            kept.append(op)
    state["operations"]=kept
    for key,at in list(state["processedUpdates"].items()):
        if instant(at)<instant(now)-timedelta(days=7):
            del state["processedUpdates"][key]
    writes={}
    for month,group in groups.items():
        content=dumps(group)
        path=f"archive/{month.replace('-','/')}/state-{state['stateVersion']}-{hashlib.sha256(content.encode()).hexdigest()[:12]}.json"
        writes[path]=content
    state["archives"]=sorted(set(state.get("archives",[]))|set(writes))
    state["lastArchiveAt"]=now
    return writes

def menu_markup(owner=False):
    rows=[["📅 Игры на неделю","🗓 Игры в этом месяце"],["🏐 Тренировки","⚙️ Подписки"],["👤 Моё ФИО"]]
    if owner:
        rows += [["📊 Статистика","👥 Заявки"],["⚙️ Состояние","🛠 Тренировки"]]
    return {"keyboard":[[{"text":text} for text in row] for row in rows],"resize_keyboard":True}

def queue_dialog(state, uid, text, now, buttons=None, key=None, menu=False):
    prefix=key or f"ui:{state.get('_updateId','job')}:{uid}:"
    parts=[text[i:i+3200] for i in range(0,len(text),3200)] or [""]
    for index,part in enumerate(parts):
        nid=prefix if key and len(parts)==1 else prefix+str(sum(n.startswith(prefix) for n in state["notifications"]))
        message={"chatId":state["users"][uid]["privateChatId"],"text":part}
        if index==len(parts)-1:
            if buttons:
                message["buttons"]=buttons
            if menu:
                message["replyMarkup"]=menu_markup(state["users"][uid]["role"]=="owner")
        state["notifications"][nid]=dict(notificationId=nid,userId=uid,type="ui",fulfills=["ui"],dueAt=now,
            status="pending",attempts=0,message=message)

def subscription_dialog(state, uid, now):
    chosen=state["subscriptions"].get(uid,[])
    buttons=[[{"text":("✅ " if scope in chosen else "▫️ ")+label,"data":"s|"+scope}] for scope,label in LABELS.items()]
    buttons.append([{"text":"Готово","data":"done"}])
    queue_dialog(state,uid,"Какие лиги и тренировки вы хотите отслеживать?",now,buttons)

def show_events(state, uid, now, period):
    today=instant(now).astimezone(MSK).date()
    end=today+timedelta(days=6-today.weekday())
    found=[]
    for e in state["events"].values():
        day=date.fromisoformat(e["localDate"])
        if e["scope"] not in state["subscriptions"].get(uid,[]):
            continue
        if period=="training":
            include=e["kind"]=="training" and upcoming(e,now) and day<=today+timedelta(days=14)
        elif e["kind"]=="training":
            include=False
        elif period=="week":
            include=today<=day<=end and upcoming(e,now)
        else:
            include=day.year==today.year and day.month==today.month
        if include:
            found.append(e)
    if not found:
        queue_dialog(state,uid,"В выбранном периоде событий по вашим подпискам нет.",now,menu=True)
    for e in sorted(found,key=lambda e:(e["localDate"],e.get("startAtUtc") or "",e["eventId"])):
        text=event_card(e,now)
        source=state["sourceState"].get(e["sourceKey"],{})
        if source.get("lastError"):
            text+="\n⚠️ Источник недоступен. Последняя проверка: "+source.get("lastSuccessAt","не завершена")
        queue_dialog(state,uid,text,now,attendance_buttons(e) if upcoming(e,now) else None,menu=True)

def show_stats(state, uid, eid, now):
    if eid not in state["events"]:
        queue_dialog(state,uid,"Событие не найдено.",now); return
    stats=event_stats(state,eid)
    text=event_card(state["events"][eid],now)
    for key,label in (("yes","✅ Будут"),("no","❌ Не будут"),("unanswered","⏳ Не ответили"),("reconfirm","🔄 Подтвердить заново")):
        text+=f"\n\n{label} — {len(stats[key])}\n"+("\n".join("• "+u["fullName"] for u in stats[key]) or "—")
    buttons=[[{"text":"Отметить участника","data":"marklist|"+eid}],[{"text":"История ответов","data":"history|"+eid}]]
    queue_dialog(state,uid,text,now,buttons)

def save_answer(state, eid, target, answer, actor, now, source):
    e=state["events"].get(eid)
    if not e or answer not in ("yes","no") or not subscribed(state,target,e["scope"]):
        return False
    key=eid+":"+target; old=state["participation"].get(key,{})
    audit(state,"ANSWER_SET",now,actor,target=key,previous=old.get("answer"),next_value={"answer":answer,"source":source,"attendanceRevision":e["attendanceRevision"]})
    state["participation"][key]={**old,"eventId":eid,"telegramUserId":target,"attendanceRevision":e["attendanceRevision"],
        "answer":answer,"answerSource":source,"answeredAt":now,"invitedAt":old.get("invitedAt",now),
        "firstPollSentAt":old.get("firstPollSentAt")}
    return True

def change_training(state, eid, action, now, actor, moved=None):
    old=state["events"].get(eid)
    if not old or old["kind"]!="training":
        raise ValueError("Тренировка не найдена")
    new=copy.deepcopy(old)
    if action=="cancel":
        new["status"]="cancelled"
    elif action=="restore":
        day=eid.removeprefix("TRAINING-")
        new.update(localDate=day,startAtUtc=start_time(day,"19:30"),venue="Буревестник",status="scheduled")
    elif action=="move" and moved:
        parts=moved.strip().split("\n",1)
        dt=datetime.strptime(parts[0].strip(),"%d.%m.%Y %H:%M").replace(tzinfo=MSK)
        new.update(localDate=dt.date().isoformat(),startAtUtc=iso(dt),status="scheduled")
        if len(parts)>1 and clean(parts[1]):
            new["venue"]=clean(parts[1])[:500]
    else:
        raise ValueError("Неизвестное действие")
    if new!=old:
        new.update(revision=old["revision"]+1,attendanceRevision=old["attendanceRevision"]+1)
        state["events"][eid]=new
        audit(state,"EVENT_CHANGED",now,actor,target=eid,previous=old,next_value=new)

def handle_update(state, update, now, setup_secret):
    number=update.get("update_id")
    if isinstance(number,bool) or not isinstance(number,int) or number<0:
        return
    key=str(number)
    if key in state["processedUpdates"] or number<state.get("pollOffset",0):
        return
    cb=update.get("callback_query",{})
    message=cb.get("message",{}) if cb else update.get("message",{})
    sender=cb.get("from",{}) if cb else message.get("from",{})
    chat=message.get("chat",{})
    state["pollOffset"]=max(state.get("pollOffset",0),number+1)
    state["processedUpdates"][key]=now
    if chat.get("type")!="private" or not isinstance(sender.get("id"),int) or chat.get("id")!=sender["id"]:
        return
    uid=str(sender["id"])
    state["_updateId"]=key
    try:
        _handle_private(state,uid,str(chat["id"]),clean(message.get("text","")),cb.get("data"),now,setup_secret)
    finally:
        state.pop("_updateId",None)

def _handle_private(state, uid, chat, text, data, now, setup_secret):
    u=state["users"].setdefault(uid,dict(telegramUserId=uid,privateChatId=chat,fullName="",role="member",
        accessStatus="pending",stage="name",registeredAt=now,deliveryStatus="active"))
    u["privateChatId"]=chat; u["deliveryStatus"]="active"
    say=lambda text,buttons=None,menu=False:queue_dialog(state,uid,text,now,buttons,menu=menu)
    if text.startswith("/owner "):
        supplied=text.partition(" ")[2]
        if not any(v["role"]=="owner" for v in state["users"].values()) and setup_secret and hmac.compare_digest(supplied,setup_secret):
            u.update(role="owner",accessStatus="approved")
            state["runtime"]["paused"]=False
            audit(state,"OWNER_BOUND",now,uid,target=uid)
            say("Вы назначены владельцем. Пришлите ФИО." if not u["fullName"] else "Вы назначены владельцем.",menu=True)
        else:
            say("Назначение владельца недоступно.")
        return
    if text in ("/start","/menu"):
        u.pop("pendingAction",None)
        if not u["fullName"]:
            u["stage"]="name"; say("Здравствуйте! Пришлите ваши фамилию, имя и отчество.")
        else:
            say("Выберите действие.",menu=True)
        return
    if not u["fullName"] or u.get("editName"):
        if text.startswith("/") or not 2<=len(text.split())<=5 or len(text)>150:
            say("Пришлите ФИО текстом, например: Иванов Иван Иванович."); return
        previous=u["fullName"];u.update(fullName=text,stage="subscriptions")
        u.pop("editName",None)
        audit(state,"NAME_SET",now,uid,target=uid,previous=previous,next_value=text)
        subscription_dialog(state,uid,now);return
    if data and (data.startswith("s|") or data=="done"):
        if data.startswith("s|"):
            scope=data[2:]
            if scope not in LABELS:
                return
            selected=state["subscriptions"].setdefault(uid,[])
            selected.remove(scope) if scope in selected else selected.append(scope)
            audit(state,"SUBSCRIPTIONS_SET",now,uid,target=uid,next_value=selected)
            subscription_dialog(state,uid,now)
        else:
            u["stage"]="ready"
            if u["accessStatus"]=="pending":
                say("Подписки сохранены. Заявка отправлена владельцу.",menu=True)
                if not u.get("requestSentAt"):
                    u["requestSentAt"]=now
                    for owner_id,owner in state["users"].items():
                        if owner["role"]=="owner" and owner["accessStatus"]=="approved":
                            queue_dialog(state,owner_id,"Заявка на доступ: "+u["fullName"],now,
                                [[{"text":"Одобрить","data":"approve|"+uid+"|y"},{"text":"Отклонить","data":"approve|"+uid+"|n"}]])
            else:
                say("Подписки сохранены.",menu=True)
        return
    if text in ("/subscriptions","⚙️ Подписки"):
        subscription_dialog(state,uid,now); return
    if text in ("/name","👤 Моё ФИО"):
        u["editName"]=True; say("Пришлите новое ФИО."); return
    if u["accessStatus"]!="approved":
        say("Ожидается подтверждение владельца." if u["accessStatus"]=="pending" else "Заявка отклонена владельцем."); return
    if data and data.startswith("r|"):
        parts=data.split("|")
        e=state["events"].get(parts[1]) if len(parts)==4 else None
        if not e or str(e["attendanceRevision"])!=parts[2] or not upcoming(e,now) or not subscribed(state,uid,e["scope"]) or parts[3] not in ("y","n"):
            say("Эта кнопка устарела или подписка отключена. Откройте актуальное расписание.");return
        save_answer(state,e["eventId"],uid,"yes" if parts[3]=="y" else "no",uid,now,"user")
        say("Ответ сохранён: "+("буду." if parts[3]=="y" else "не буду."),menu=True);return
    if text in ("/week","📅 Игры на неделю"):
        show_events(state,uid,now,"week");return
    if text in ("/month","🗓 Игры в этом месяце"):
        show_events(state,uid,now,"month");return
    if text in ("/trainings","🏐 Тренировки"):
        show_events(state,uid,now,"training");return
    if u["role"]!="owner":
        say("Выберите действие.",menu=True);return
    pending=u.get("pendingAction")
    if pending and pending["kind"]=="move-training" and text and not text.startswith("/"):
        try:
            change_training(state,pending["eventId"],"move",now,uid,text.replace(" / ","\n"))
            del u["pendingAction"];say("Тренировка перенесена.",menu=True)
        except ValueError:
            say("Формат: ДД.ММ.ГГГГ ЧЧ:ММ. Новое место можно добавить через « / ».")
        return
    if text in ("/pause","/resume"):
        state["runtime"]["paused"]=text=="/pause"
        audit(state,"SET_PAUSED",now,uid,next_value=state["runtime"]["paused"])
        say("Рассылки приостановлены." if text=="/pause" else "Рассылки включены.",menu=True);return
    if text in ("/sync","Проверить расписание"):
        state["lastSyncAt"]=None;say("Проверка расписания запрошена.");return
    if text in ("/pending","👥 Заявки"):
        applicants=[v for v in state["users"].values() if v["accessStatus"]=="pending" and v["fullName"]]
        if not applicants:
            say("Новых заявок нет.")
        for applicant in applicants:
            target=applicant["telegramUserId"]
            say(applicant["fullName"],[[{"text":"Одобрить","data":f"approve|{target}|y"},{"text":"Отклонить","data":f"approve|{target}|n"}]])
        return
    if data and data.startswith("approve|"):
        parts=data.split("|")
        target=state["users"].get(parts[1]) if len(parts)==3 else None
        if not target or target["role"]=="owner" or parts[2] not in ("y","n"):
            return
        target["accessStatus"]="approved" if parts[2]=="y" else "rejected"
        audit(state,"ACCESS_SET",now,uid,target=parts[1],next_value=target["accessStatus"])
        say(target["fullName"]+": "+("доступ открыт." if parts[2]=="y" else "заявка отклонена."))
        queue_dialog(state,parts[1],"Доступ подтверждён. Выберите действие." if parts[2]=="y" else "Заявка отклонена владельцем.",now,menu=parts[2]=="y")
        return
    if text in ("/stats","📊 Статистика","🛠 Тренировки"):
        training=text=="🛠 Тренировки"
        today=instant(now).astimezone(MSK).date()
        items=[e for e in state["events"].values() if today-timedelta(days=7)<=date.fromisoformat(e["localDate"])<=today+timedelta(days=31) and (not training or e["kind"]=="training")]
        buttons=[[{"text":f"{LABELS[e['scope']]} {date.fromisoformat(e['localDate']):%d.%m} {e['opponent']}"[:60],"data":("train|" if training else "stat|")+e["eventId"]}] for e in sorted(items,key=lambda e:(e["localDate"],e["eventId"]))]
        say("Выберите событие:" if buttons else "Событий пока нет.",buttons[:40]);return
    if data and data.startswith("stat|"):
        show_stats(state,uid,data[5:],now);return
    if data and data.startswith("marklist|"):
        eid=data[9:];e=state["events"].get(eid)
        if not e:
            return
        buttons=[[{"text":v["fullName"],"data":f"markpick|{eid}|{target}"}] for target,v in state["users"].items() if subscribed(state,target,e["scope"])]
        say("Кого отметить?",buttons);return
    if data and data.startswith("markpick|"):
        parts=data.split("|")
        if len(parts)!=3 or parts[2] not in state["users"]:
            return
        say(state["users"][parts[2]]["fullName"],[[{"text":"✅ Будет","data":f"mark|{parts[1]}|{parts[2]}|y"},{"text":"❌ Не будет","data":f"mark|{parts[1]}|{parts[2]}|n"}]])
        return
    if data and data.startswith("mark|"):
        parts=data.split("|")
        if len(parts)==4 and parts[3] in ("y","n") and save_answer(state,parts[1],parts[2],"yes" if parts[3]=="y" else "no",uid,now,"admin"):
            show_stats(state,uid,parts[1],now)
        return
    if data and data.startswith("history|"):
        eid=data[8:]
        rows=[]
        for op in state["operations"]:
            if op["action"]=="ANSWER_SET" and op.get("targetId","").startswith(eid+":"):
                target=op["targetId"][len(eid)+1:]
                rows.append(f"{op['at']}: {state['users'].get(target,{}).get('fullName',target)} — {op['previous'] or 'нет ответа'} → {op['next']['answer']} ({op['next']['source']})")
        say("\n".join(rows[-30:]) or "Ответов пока нет.");return
    if data and data.startswith("train|"):
        eid=data[6:]
        say("Управление отдельной тренировкой",[[{"text":"Отменить","data":"tcancel|"+eid},{"text":"Восстановить","data":"trestore|"+eid}],[{"text":"Перенести","data":"tmove|"+eid}]])
        return
    if data and data.startswith(("tcancel|","trestore|","tmove|")):
        action,eid=data.split("|",1)
        if eid not in state["events"] or state["events"][eid]["kind"]!="training":
            return
        if action=="tmove":
            u["pendingAction"]={"kind":"move-training","eventId":eid}
            say("Пришлите ДД.ММ.ГГГГ ЧЧ:ММ. Новое место можно добавить через « / ».")
        else:
            change_training(state,eid,"cancel" if action=="tcancel" else "restore",now,uid)
            say("Тренировка изменена.")
        return
    if text in ("/status","⚙️ Состояние"):
        rows=[f"Среда: {state['runtime']['id']}, epoch {state['runtime']['epoch']}",
              "Рассылки: "+("пауза" if state["runtime"]["paused"] else "включены")]
        for scope,health in state["sourceState"].items():
            rows.append(f"{LABELS.get(scope,scope)}: "+(health.get("lastError") or "проверено "+health.get("lastSuccessAt","—")))
        counts={}
        for n in state["notifications"].values():
            counts[n["status"]]=counts.get(n["status"],0)+1
        rows.append("Доставка: "+", ".join(f"{k}: {v}" for k,v in counts.items()))
        buttons=[[{"text":"Проверить расписание","data":"sync"}]]
        for n in state["notifications"].values():
            if n["status"]=="uncertain":
                key=hashlib.sha256(n["notificationId"].encode()).hexdigest()[:16]
                buttons.append([{"text":"Повторить вручную: "+state["users"].get(n["userId"],{}).get("fullName","участник"),"data":"retry|"+key}])
        say("\n".join(rows),buttons[:15]);return
    if data=="sync":
        state["lastSyncAt"]=None;say("Проверка расписания запрошена.");return
    if data and data.startswith("retry|"):
        for n in state["notifications"].values():
            if hashlib.sha256(n["notificationId"].encode()).hexdigest()[:16]==data[6:] and n["status"]=="uncertain":
                n.update(status="retry",nextAttemptAt=now,terminal=False)
                audit(state,"DELIVERY_MANUAL_RETRY",now,uid,target=n["notificationId"])
                say("Повторная отправка запрошена. Первое сообщение могло уже прийти.")
                return
    say("Выберите действие.",menu=True)

class FencedError(RuntimeError):
    """Another runtime or process owns this bot."""

class ApiError(RuntimeError):
    def __init__(self, status, retry_after=30):
        super().__init__(f"GitHub API unavailable ({status})")
        self.status=status
        self.retry_after=retry_after

@dataclass
class Response:
    status: int
    body: str
    headers: dict
    def json(self):
        return json.loads(self.body)

class Http:
    def request(self, method, url, body=None, headers=None, timeout=25):
        payload=dumps(body).encode() if body is not None else None
        request=urllib.request.Request(url,data=payload,method=method,
            headers={"User-Agent":"sechenov-volley-bot/1.0","Content-Type":"application/json",**(headers or {})})
        try:
            with urllib.request.urlopen(request,timeout=timeout) as reply:
                data=reply.read(8*1024*1024+1)
                if len(data)>8*1024*1024:
                    raise ValueError("Response exceeds the size limit")
                return Response(reply.status,data.decode("utf-8-sig"),dict(reply.headers))
        except urllib.error.HTTPError as exc:
            # Do not log the URL, request body or credentials.
            data=exc.read(1024*1024)
            return Response(exc.code,data.decode("utf-8",errors="replace"),dict(exc.headers))
        except (urllib.error.URLError,TimeoutError,OSError) as exc:
            raise ApiError(0) from None

@dataclass
class TransactionResult:
    value: object = None
    files: dict | None = None

class GitHubRepository:
    """One atomic Git commit per state transition; reducers may be replayed."""
    def __init__(self,http,token,repo,branch,runtime_id,epoch):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",repo):
            raise ValueError("Invalid GitHub repository")
        if not re.fullmatch(r"codex/[A-Za-z0-9][A-Za-z0-9/-]*",branch):
            raise ValueError("The data branch must be under codex/")
        if isinstance(epoch,bool) or not isinstance(epoch,int) or epoch<1:
            raise ValueError("Runtime epoch must be a positive integer")
        self.http,self.token,self.repo,self.branch=http,token,repo,branch
        self.runtime_id,self.epoch=runtime_id,epoch
        self.cache=None
        self.lock=threading.RLock()
        self.private_checked_at=0.0

    def response(self,method,path="",body=None):
        return self.http.request(method,"https://api.github.com/repos/"+self.repo+("/"+path if path else ""),body,
            {"Authorization":"Bearer "+self.token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"})

    def api(self,method,path="",body=None):
        reply=self.response(method,path,body)
        if not 200<=reply.status<300:
            headers={k.lower():v for k,v in reply.headers.items()}
            retry=30
            try:
                retry=int(headers.get("retry-after","30"))
                if headers.get("x-ratelimit-remaining")=="0":
                    retry=max(retry,int(headers.get("x-ratelimit-reset","0"))-int(time.time())+1)
            except ValueError:
                pass
            raise ApiError(reply.status,max(1,min(retry,3600)))
        try:
            return reply.json()
        except (ValueError,TypeError):
            raise ApiError(502) from None

    def assert_private(self, force=False):
        if force or time.monotonic()-self.private_checked_at>=60:
            if self.api("GET").get("private") is not True:
                raise FencedError("Business state requires a private GitHub repository")
            self.private_checked_at=time.monotonic()

    def ref(self):
        return "heads/"+urllib.parse.quote(self.branch,safe="/")

    @staticmethod
    def validate(state):
        if state.get("schemaVersion")!=1 or isinstance(state.get("stateVersion"),bool) or not isinstance(state.get("stateVersion"),int):
            raise ValueError("Unknown state schema; storage was not changed")
        runtime=state.get("runtime",{})
        if not isinstance(runtime,dict) or not runtime.get("id") or type(runtime.get("epoch")) is not int:
            raise ValueError("Invalid runtime manifest")
        for key in SECTIONS.values():
            expected=list if key=="operations" else dict
            if not isinstance(state.get(key),expected):
                raise ValueError("Invalid state section: "+key)
        for uid,u in state["users"].items():
            if not isinstance(u,dict) or u.get("telegramUserId")!=uid or u.get("role") not in ("owner","member") or u.get("accessStatus") not in ("pending","approved","rejected"):
                raise ValueError("Invalid user state")
        for scopes in state["subscriptions"].values():
            if not isinstance(scopes,list) or any(scope not in LABELS for scope in scopes):
                raise ValueError("Invalid subscription state")
        for eid,e in state["events"].items():
            if not isinstance(e,dict) or e.get("eventId")!=eid or e.get("scope") not in LABELS or not isinstance(e.get("attendanceRevision"),int):
                raise ValueError("Invalid event state")
            full_date(e["localDate"]); event_instant(e)
        for n in state["notifications"].values():
            if not isinstance(n,dict) or n.get("status") not in ("pending","sending","sent","retry","uncertain","cancelled") or not isinstance(n.get("message"),dict):
                raise ValueError("Invalid delivery state")
        state.setdefault("pollOffset",0)
        state.setdefault("lease",None)
        state.setdefault("archivedEvents",{})
        state.setdefault("archives",[])
        if type(state["pollOffset"]) is not int or state["pollOffset"]<0:
            raise ValueError("Invalid polling cursor")

    def snapshot(self):
        self.assert_private()
        head=self.api("GET","git/ref/"+self.ref())["object"]["sha"]
        if self.cache and self.cache["head"]==head:
            return copy.deepcopy(self.cache)
        commit=self.api("GET","git/commits/"+head)
        tree=self.api("GET","git/trees/"+commit["tree"]["sha"]+"?recursive=1")
        if tree.get("truncated"):
            raise ValueError("GitHub returned an incomplete state tree")
        indexed={item["path"]:item for item in tree["tree"] if item["type"]=="blob" and item["mode"]=="100644"}
        paths=["state/manifest.json",*SECTIONS]
        if any(path not in indexed for path in paths):
            raise ValueError("Data branch exists without a recognized state; refusing to overwrite it")
        def read_file(path):
            blob=self.api("GET","git/blobs/"+indexed[path]["sha"])
            if blob.get("encoding")!="base64":
                raise ValueError("Unsupported GitHub blob encoding")
            return path,base64.b64decode(blob["content"]).decode("utf-8")
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            files=dict(pool.map(read_file,paths))
        state=json.loads(files["state/manifest.json"])
        for path,key in SECTIONS.items():
            state[key]=json.loads(files[path])
        self.validate(state)
        self.cache={"head":head,"tree":commit["tree"]["sha"],"state":copy.deepcopy(state),"files":files}
        return copy.deepcopy(self.cache)

    def read(self):
        with self.lock:
            return self.snapshot()["state"]

    @staticmethod
    def serialize(state):
        # Keep unknown manifest fields when moving between runtime adapters.
        values={"state/manifest.json":{k:v for k,v in state.items() if k not in SECTIONS.values() and not k.startswith("_")}}
        values.update({path:state[key] for path,key in SECTIONS.items()})
        return {path:dumps(value) for path,value in values.items()}

    def guard(self,state):
        runtime=state["runtime"]
        if runtime["id"]!=self.runtime_id or runtime["epoch"]!=self.epoch:
            raise FencedError("This runtime/epoch is not active")

    def initialise(self,state):
        with self.lock:
            self.assert_private(force=True)
            existing=self.response("GET","git/ref/"+self.ref())
            if existing.status==200:
                current=self.read();self.guard(current);return current
            if existing.status!=404:
                raise ApiError(existing.status)
            metadata=self.api("GET")
            parent=self.api("GET","git/ref/heads/"+urllib.parse.quote(metadata["default_branch"],safe="/"))["object"]["sha"]
            parent_commit=self.api("GET","git/commits/"+parent)
            files=self.serialize(state)
            tree=self.api("POST","git/trees",{"base_tree":parent_commit["tree"]["sha"],
                "tree":[{"path":p,"mode":"100644","type":"blob","content":c} for p,c in files.items()]})
            commit=self.api("POST","git/commits",{"message":"bot: initialise private state","tree":tree["sha"],"parents":[parent]})
            created=self.response("POST","git/refs",{"ref":"refs/"+self.ref(),"sha":commit["sha"]})
            if created.status not in (200,201,409,422):
                raise ApiError(created.status)
            current=self.read();self.guard(current);return current

    def transact(self,reducer, *, takeover_epoch=None):
        with self.lock:
            for attempt in range(3):
                snap=self.snapshot(); state=copy.deepcopy(snap["state"])
                if takeover_epoch is None:
                    self.guard(state)
                elif state["runtime"]["epoch"]!=takeover_epoch:
                    raise FencedError("Takeover expected a different previous epoch")
                outcome=reducer(state)
                extra=outcome.files or {} if isinstance(outcome,TransactionResult) else {}
                value=outcome.value if isinstance(outcome,TransactionResult) else outcome
                if state==snap["state"] and not extra:
                    return value
                self.validate(state)
                state["stateVersion"]+=1
                files=self.serialize(state)
                changes=[{"path":p,"mode":"100644","type":"blob","content":c} for p,c in {**files,**extra}.items() if c!=snap["files"].get(p)]
                tree=self.api("POST","git/trees",{"base_tree":snap["tree"],"tree":changes})
                commit=self.api("POST","git/commits",{"message":"bot: private state transition","tree":tree["sha"],"parents":[snap["head"]]})
                reply=self.response("PATCH","git/refs/"+self.ref(),{"sha":commit["sha"],"force":False})
                if 200<=reply.status<300:
                    self.cache={"head":commit["sha"],"tree":tree["sha"],"state":copy.deepcopy(state),"files":{**snap["files"],**files,**extra}}
                    return value
                if reply.status not in (409,422):
                    # An unknown PATCH outcome is resolved by a fresh read/replayed reducer.
                    raise ApiError(reply.status)
                fresh=self.api("GET","git/ref/"+self.ref())["object"]["sha"]
                if fresh==snap["head"]:
                    raise ApiError(reply.status)
            raise ApiError(409)

class SheetSource:
    def __init__(self,http,sources=None):
        self.http=http
        self.sources=sources or SOURCES
    def read(self):
        def one(config):
            scope=config["scope"]
            try:
                url="https://docs.google.com/spreadsheets/d/"+config["book"]+"/export?format=csv&gid="+str(config["gid"])
                reply=self.http.request("GET",url,timeout=20)
                if reply.status!=200:
                    raise ValueError("CSV unavailable")
                found=normalize_chm(reply.body,config.get("season","2026/2027")) if scope=="CHM" else normalize_own(reply.body,scope)
                return {"sourceId":scope,"ok":True,"events":found}
            except (ApiError,ValueError,csv.Error,UnicodeError,KeyError):
                return {"sourceId":scope,"ok":False,"events":[],"error":"Не удалось прочитать расписание "+LABELS.get(scope,scope)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            return list(pool.map(one,self.sources))

class VolleyBot:
    def __init__(self,repository,telegram,sources,setup_secret,clock=now_utc):
        self.repo,self.telegram,self.sources=repository,telegram,sources
        self.secret,self.clock=setup_secret,clock
        self.instance_id=uuid.uuid4().hex
        self.stop=__import__("asyncio").Event()

    def check_lease(self,state,now):
        self.repo.guard(state)
        lease=state.get("lease") or {}
        if lease.get("holder")!=self.instance_id or instant(lease.get("expiresAt","1970-01-01T00:00:00Z"))<=instant(now):
            raise FencedError("Another process owns the bot lease")

    async def tx(self,reducer):
        import asyncio
        return await asyncio.to_thread(self.repo.transact,reducer)

    async def read(self):
        import asyncio
        return await asyncio.to_thread(self.repo.read)

    async def acquire_lease(self):
        now=self.clock()
        def claim(state):
            lease=state.get("lease") or {}
            if lease.get("holder") not in (None,self.instance_id) and instant(lease.get("expiresAt","1970-01-01T00:00:00Z"))>instant(now):
                raise FencedError("Another bot process is running")
            if lease.get("holder")!=self.instance_id or instant(lease.get("expiresAt","1970-01-01T00:00:00Z"))-instant(now)<timedelta(seconds=90):
                state["lease"]={"holder":self.instance_id,"expiresAt":iso(instant(now)+timedelta(seconds=120))}
        await self.tx(claim)

    async def release_lease(self):
        def release(state):
            if (state.get("lease") or {}).get("holder")==self.instance_id:
                state["lease"]=None
        try:
            await self.tx(release)
        except (ApiError,FencedError,ValueError):
            pass

    async def process_update(self,update):
        now=self.clock()
        payload=update.model_dump(mode="json",by_alias=True,exclude_none=True)
        def apply(state):
            self.check_lease(state,now)
            handle_update(state,payload,now,self.secret)
        await self.tx(apply)
        if update.callback_query:
            try:
                await self.telegram.answer_callback_query(update.callback_query.id)
            except Exception:
                # The business reply is already committed; an expired callback is harmless.
                pass

    async def tick(self):
        import asyncio
        now=self.clock(); state=await self.read()
        if state["runtime"].get("paused"):
            return
        if state.get("lastSyncAt") and instant(now)-instant(state["lastSyncAt"])<timedelta(minutes=5):
            return
        snapshots=await asyncio.to_thread(self.sources.read)
        def apply(current):
            self.check_lease(current,now)
            if current["runtime"].get("paused"):
                return
            synchronize(current,snapshots,now)
            generate_trainings(current,now)
            plan_notifications(current,now)
            current["lastSyncAt"]=now
            writes={}
            if not current.get("lastArchiveAt") or instant(current["lastArchiveAt"]).astimezone(MSK).date()!=instant(now).astimezone(MSK).date():
                writes=archive_state(current,now)
            return TransactionResult(files=writes)
        await self.tx(apply)

    async def deliver_due(self,limit=20):
        from aiogram.types import InlineKeyboardMarkup,InlineKeyboardButton,ReplyKeyboardMarkup
        from aiogram.exceptions import TelegramRetryAfter,TelegramForbiddenError,TelegramBadRequest,TelegramUnauthorizedError
        now=self.clock()
        def recover(state):
            self.check_lease(state,now)
            for n in state["notifications"].values():
                if n["status"]=="sending" and n.get("sendingAt") and instant(now)-instant(n["sendingAt"])>=timedelta(minutes=5):
                    n.update(status="uncertain",error="Результат отправки неизвестен после остановки процесса")
        await self.tx(recover)
        state=await self.read()
        ready=sorted((n for n in state["notifications"].values() if n["status"] in ("pending","retry")
            and instant(n.get("nextAttemptAt") or n["dueAt"])<=instant(now)
            and (not state["runtime"].get("paused") or n["type"]=="ui")),
            key=lambda n:(n["type"]!="ui",n["dueAt"],n["notificationId"]))[:limit]
        for candidate in ready:
            if self.stop.is_set():
                break
            await self.acquire_lease()
            now=self.clock(); nid=candidate["notificationId"]; claim_id=uuid.uuid4().hex
            def claim(current):
                self.check_lease(current,now)
                n=current["notifications"].get(nid)
                if not n or n["status"] not in ("pending","retry"):
                    return None
                if current["runtime"].get("paused") and n["type"]!="ui":
                    return None
                if not can_deliver(current,n,now):
                    n["status"]="cancelled";return None
                if instant(n.get("nextAttemptAt") or n["dueAt"])>instant(now):
                    return None
                n.update(status="sending",sendingAt=now,lease=claim_id,attempts=n["attempts"]+1)
                return copy.deepcopy(n)
            notice=await self.tx(claim)
            if notice is None:
                continue
            def final_check(current):
                self.check_lease(current,self.clock())
                n=current["notifications"].get(nid)
                if not n or n["status"]!="sending" or n.get("lease")!=claim_id:
                    return False
                if not can_deliver(current,n,self.clock()) or (current["runtime"].get("paused") and n["type"]!="ui"):
                    n["status"]="cancelled";return False
                return True
            if not await self.tx(final_check):
                continue
            message=notice["message"]
            markup=None
            if message.get("buttons"):
                markup=InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text=b["text"],callback_data=b["data"]) for b in row] for row in message["buttons"]])
            elif message.get("replyMarkup"):
                markup=ReplyKeyboardMarkup.model_validate(message["replyMarkup"])
            outcome, result, retry_after="uncertain",None,0
            try:
                result=await self.telegram.send_message(chat_id=message["chatId"],text=message["text"],reply_markup=markup)
                outcome="sent"
            except TelegramRetryAfter as exc:
                outcome="retry";retry_after=exc.retry_after
            except TelegramForbiddenError:
                outcome="blocked"
            except TelegramBadRequest:
                outcome="terminal"
            except TelegramUnauthorizedError:
                raise
            except Exception:
                # A timeout or server failure can occur after Telegram accepted the message.
                outcome="uncertain"
            delivered_at=self.clock()
            def complete(current):
                self.check_lease(current,delivered_at)
                n=current["notifications"].get(nid)
                if not n or n["status"]!="sending" or n.get("lease")!=claim_id:
                    return
                if outcome=="sent":
                    n.update(status="sent",sentAt=delivered_at,messageId=str(result.message_id))
                    p=current["participation"].get(n.get("eventId","")+":"+n["userId"])
                    if "poll" in n.get("fulfills",[]) and p and p.get("pollRevision")==n.get("attendanceRevision"):
                        p["firstPollSentAt"]=delivered_at
                elif outcome=="retry" and n["attempts"]<5:
                    n.update(status="retry",nextAttemptAt=iso(instant(delivered_at)+timedelta(seconds=max(1,retry_after))),error="Telegram ограничил частоту")
                elif outcome=="uncertain":
                    n.update(status="uncertain",error="Telegram мог принять сообщение; требуется решение владельца")
                else:
                    n.update(status="cancelled",terminal=True,error="Получатель заблокировал бота" if outcome=="blocked" else "Telegram отклонил отправку")
                    if outcome=="blocked":
                        current["users"][n["userId"]]["deliveryStatus"]="blocked"
            await self.tx(complete)

    async def poll_once(self):
        await self.acquire_lease()
        state=await self.read(); self.check_lease(state,self.clock())
        updates=await self.telegram.get_updates(offset=state.get("pollOffset",0),timeout=25,
            allowed_updates=["message","callback_query"],request_timeout=35)
        for update in updates:
            if self.stop.is_set():
                break
            await self.process_update(update)
        # No higher offset is sent until all prior updates were durably committed.
        await self.tick()
        await self.deliver_due()

    async def run(self):
        import asyncio
        from aiogram.exceptions import TelegramConflictError,TelegramUnauthorizedError
        loop=asyncio.get_running_loop()
        for sig in (signal.SIGINT,signal.SIGTERM):
            try:
                loop.add_signal_handler(sig,self.stop.set)
            except NotImplementedError:
                pass
        await self.acquire_lease()
        LOG.info("Bot started; private GitHub storage and aiogram polling")
        try:
            while not self.stop.is_set():
                try:
                    await self.poll_once()
                    write_health()
                except (FencedError,TelegramConflictError,TelegramUnauthorizedError):
                    LOG.error("Bot stopped: runtime lease, duplicate poller or authorization conflict")
                    raise
                except Exception as exc:
                    # Do not print exception text: it can contain request URLs or user input.
                    LOG.warning("Temporary failure: %s",type(exc).__name__)
                    delay=exc.retry_after if isinstance(exc,ApiError) else 10
                    try:
                        await asyncio.wait_for(self.stop.wait(),timeout=max(1,delay))
                    except TimeoutError:
                        pass
        finally:
            await self.release_lease()

def load_environment(path):
    if not path:
        return
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        value=line.strip()
        if not value or value.startswith("#"):
            continue
        if "=" not in value:
            raise ValueError("Malformed environment file")
        key,item=value.split("=",1)
        key=key.strip();item=item.strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*",key):
            raise ValueError("Malformed environment variable")
        if len(item)>=2 and item[0]==item[-1] and item[0] in ("'",'"'):
            item=item[1:-1]
        os.environ.setdefault(key,item)

def write_health():
    path=Path(os.environ.get("BOT_HEALTH_FILE","/tmp/sechenov-volley-health.json"))
    temporary=path.with_suffix(".tmp")
    temporary.write_text(dumps({"at":now_utc()}),encoding="utf-8")
    temporary.replace(path)

def health_ok():
    try:
        health=json.loads(Path(os.environ.get("BOT_HEALTH_FILE","/tmp/sechenov-volley-health.json")).read_text())
        age=datetime.now(UTC)-instant(health["at"])
        return timedelta(0)<=age<timedelta(seconds=180)
    except (OSError,ValueError,KeyError):
        return False

async def serve(args):
    import asyncio
    from aiogram import Bot as TelegramBot
    load_environment(os.environ.get("BOT_ENV_FILE"))
    required=("TELEGRAM_BOT_TOKEN","BOT_GITHUB_TOKEN","OWNER_SETUP_SECRET")
    if any(not os.environ.get(key) for key in required):
        raise ValueError("Set TELEGRAM_BOT_TOKEN, BOT_GITHUB_TOKEN and OWNER_SETUP_SECRET in the environment")
    epoch=int(os.environ.get("RUNTIME_EPOCH","1"))
    runtime_id=os.environ.get("RUNTIME_ID","server-primary")
    http=Http()
    repository=GitHubRepository(http,os.environ["BOT_GITHUB_TOKEN"],
        os.environ.get("GITHUB_REPO","um1ra-volley/sechenov-volley-bot"),
        os.environ.get("DATA_BRANCH","codex/bot-data"),runtime_id,epoch)
    telegram=TelegramBot(os.environ["TELEGRAM_BOT_TOKEN"])
    sources=SheetSource(http)
    try:
        me=await telegram.get_me()
        if me.username!="sechenov_volley_bot":
            raise ValueError("The token belongs to another Telegram bot")
        webhook=await telegram.get_webhook_info()
        if args.command=="disable-webhook":
            await telegram.delete_webhook(drop_pending_updates=False)
            print("Webhook disabled; pending updates preserved.")
            return
        if args.command=="takeover":
            if args.expected_epoch is None or epoch!=args.expected_epoch+1:
                raise ValueError("Set RUNTIME_EPOCH to --expected-epoch + 1")
            def switch(state):
                state["runtime"]={"id":runtime_id,"epoch":epoch,"paused":True}
                state["lease"]=None
                audit(state,"RUNTIME_TAKEOVER",now_utc(),next_value=state["runtime"])
            await asyncio.to_thread(repository.transact,switch,takeover_epoch=args.expected_epoch)
            print("Runtime switched; notifications paused. The owner can use /resume.")
            return
        if args.command=="check":
            await asyncio.to_thread(repository.assert_private,True)
            snapshots=await asyncio.to_thread(sources.read)
            print(dumps({"bot":me.username,"private_repository":repository.repo,"webhook_configured":bool(webhook.url),
                "sources":[{"scope":s["sourceId"],"ok":s["ok"],"events":len(s["events"])} for s in snapshots]}))
            if not all(s["ok"] for s in snapshots):
                raise ValueError("At least one schedule source is unavailable")
            return
        if webhook.url:
            raise ValueError("A webhook is configured. Stop the old runtime, then run disable-webhook explicitly.")
        await asyncio.to_thread(repository.initialise,empty_state(runtime_id,epoch))
        if args.command=="init":
            print("Private data branch is initialized; existing data was preserved.")
            return
        app=VolleyBot(repository,telegram,sources,os.environ["OWNER_SETUP_SECRET"])
        await app.run()
    finally:
        await telegram.session.close()

def main():
    parser=argparse.ArgumentParser(description="Sechenov volleyball Telegram bot on aiogram 3")
    parser.add_argument("command",nargs="?",default="run",choices=("run","init","check","health","disable-webhook","takeover"))
    parser.add_argument("--expected-epoch",type=int)
    args=parser.parse_args()
    if args.command=="health":
        raise SystemExit(0 if health_ok() else 1)
    logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
    try:
        import asyncio
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        LOG.error("Stopped: %s",type(exc).__name__)
        # Explicit configuration messages are our own; never echo network exception bodies.
        if isinstance(exc,(ValueError,FencedError)) and not isinstance(exc,json.JSONDecodeError):
            print(str(exc),file=sys.stderr)
        raise SystemExit(1)

if __name__=="__main__":
    main()
