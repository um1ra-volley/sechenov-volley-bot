"""Google Sheets projection of bot state; credentials stay in the server environment."""
from __future__ import annotations
import json
import os
import re
import urllib.parse

DEFAULT_SPREADSHEET="1qoniSvNsRrRpxPycM8vqMcZq7gvO7lcGLYdjrEz0L3k"
LEAGUE_SHEETS={"MSSI":"МССИ","LVL":"лвл","LCHB":"ЛЧБ"}
MATRIX_PREFIX=["attendance:v1","","telegramUserId","subscriptions"]

class AttendanceSheetError(RuntimeError):
    """A safe diagnostic with no request, credential or personal-data content."""

def column_name(number):
    value=""
    while number:
        number,digit=divmod(number-1,26)
        value=chr(65+digit)+value
    return value

def matrix_values(old,snapshot):
    """Merge by Telegram/event IDs, preserving archived columns and former users."""
    if old and (len(old)<2 or old[1][:4]!=MATRIX_PREFIX):
        raise AttendanceSheetError("Заголовки листа «Посещаемость» изменены")
    ids=old[1][4:] if old else []
    if any(not isinstance(eid,str) or not eid for eid in ids) or len(set(ids))!=len(ids):
        raise AttendanceSheetError("Повторяющиеся или пустые ID мероприятий")
    headers={eid:str(old[0][index+4]) if len(old[0])>index+4 else eid for index,eid in enumerate(ids)}
    people={}
    for row in old[2:]:
        if not any(row):
            continue
        if len(row)<3 or not str(row[2]).isdigit() or str(row[2]) in people:
            raise AttendanceSheetError("В служебных строках участников изменён Telegram ID")
        uid=str(row[2])
        people[uid]={"id":uid,"name":str(row[1]),"subscriptions":str(row[3]) if len(row)>3 else "",
            "answers":{eid:str(row[index+4]) if len(row)>index+4 else "" for index,eid in enumerate(ids)}}
    for user in snapshot["users"]:
        existing=people.setdefault(user["id"],{"answers":{}})
        existing.update(user)
    for event in snapshot["events"]:
        if event["id"] not in headers:
            ids.append(event["id"])
        headers[event["id"]]=event["header"]
        for uid,person in people.items():
            if uid in event["answers"]:
                person["answers"][event["id"]]=event["answers"][uid]
    def order(eid):
        found=re.search(r"(\d{2})\.(\d{2})\.(\d{4})",headers[eid])
        return (found[3]+found[2]+found[1] if found else "99999999",headers[eid],eid)
    ids.sort(key=order)
    rows=[["№","ФИО","Telegram ID","Подписки",*[headers[eid] for eid in ids]],MATRIX_PREFIX+ids]
    users=sorted(people.values(),key=lambda u:(u["name"].casefold().replace("ё","е"),u["id"]))
    for index,user in enumerate(users,1):
        rows.append([str(index),user["name"],user["id"],user["subscriptions"],
            *[user["answers"].get(eid,"—") for eid in ids]])
    return rows

class GoogleAttendance:
    def __init__(self,http):
        self.http=http
        self.spreadsheet=os.environ.get("ATTENDANCE_SPREADSHEET_ID",DEFAULT_SPREADSHEET).strip()
        self.title=os.environ.get("ATTENDANCE_SHEET_NAME","Посещаемость").strip()
        self.raw_credentials=os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON","").strip()
        self.credentials=None
        self.identity=self.spreadsheet+"|"+self.title

    @property
    def configured(self):
        return bool(self.raw_credentials and self.spreadsheet and self.title)

    def token(self):
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        try:
            if self.credentials is None:
                info=json.loads(self.raw_credentials)
                if info.get("type")!="service_account" or info.get("token_uri")!="https://oauth2.googleapis.com/token":
                    raise ValueError("Unexpected credential configuration")
                self.credentials=service_account.Credentials.from_service_account_info(info,
                    scopes=["https://www.googleapis.com/auth/spreadsheets"])
            if not self.credentials.valid:
                transport=Request()
                self.credentials.refresh(lambda **kwargs:transport(**{**kwargs,"timeout":20}))
            return self.credentials.token
        except Exception:
            raise AttendanceSheetError("Не удалось авторизовать служебный Google-аккаунт") from None

    def request(self,method,suffix,fence,body=None):
        fence()
        token=self.token()
        fence()
        try:
            reply=self.http.request(method,"https://sheets.googleapis.com/v4/spreadsheets/"+
                urllib.parse.quote(self.spreadsheet,safe="")+suffix,body,
                headers={"Authorization":"Bearer "+token},timeout=20)
        except Exception:
            raise AttendanceSheetError("Google Таблицы: ошибка сети") from None
        fence()
        if not 200<=reply.status<300:
            raise AttendanceSheetError("Google Таблицы: HTTP "+str(reply.status))
        try:
            return reply.json()
        except (ValueError,UnicodeError):
            raise AttendanceSheetError("Google Таблицы вернули некорректный ответ") from None

    def values(self,title,end,fence,start="A1"):
        cell_range="'"+title.replace("'","''")+"'!"+start+":"+end
        return self.request("GET","/values/"+urllib.parse.quote(cell_range,safe="")+
            "?valueRenderOption=FORMATTED_VALUE",fence).get("values",[])

    @staticmethod
    def cells(sheet_id,row,column,values):
        return {"updateCells":{"start":{"sheetId":sheet_id,"rowIndex":row,"columnIndex":column},
            "rows":[{"values":[{"userEnteredValue":{"stringValue":str(value)}} for value in line]} for line in values],
            "fields":"userEnteredValue"}}

    def sync(self,snapshot,fence):
        metadata=self.request("GET","?fields=sheets.properties",fence)
        sheets={sheet["properties"]["title"]:sheet["properties"] for sheet in metadata.get("sheets",[])}
        if self.title not in sheets:
            raise AttendanceSheetError("Добавьте лист «Посещаемость» из инструкции")
        props=sheets[self.title];grid=props["gridProperties"];sid=props["sheetId"]
        old=self.values(self.title,column_name(grid["columnCount"])+str(grid["rowCount"]),fence)
        rows=matrix_values(old,snapshot)
        width=len(rows[0]);height=len(rows)
        if width*height>100000 or len(json.dumps(rows,ensure_ascii=False).encode())>1800000:
            raise AttendanceSheetError("Лист посещаемости слишком большой для одной синхронизации")
        requests=[]
        if height>grid["rowCount"] or width>grid["columnCount"]:
            requests.append({"updateSheetProperties":{"properties":{"sheetId":sid,"gridProperties":{
                "rowCount":max(grid["rowCount"],height+100),"columnCount":max(grid["columnCount"],width+10)}},
                "fields":"gridProperties.rowCount,gridProperties.columnCount"}})
        requests.append(self.cells(sid,0,0,rows))
        # Own source sheets: update column G only, matching the unchanged event ID in A.
        # The external CHM workbook is never written.
        for scope,title in LEAGUE_SHEETS.items():
            if title not in sheets:
                raise AttendanceSheetError("Не найден лист расписания "+title)
            league=sheets[title];league_rows=self.values(title,"G"+str(league["gridProperties"]["rowCount"]),fence,start="A5")
            if not league_rows or league_rows[0][0]!="ID игры":
                raise AttendanceSheetError("Изменены заголовки листа "+title)
            header=league_rows[0][6] if len(league_rows[0])>6 else ""
            if header!="Участие":
                raise AttendanceSheetError("Нет служебной колонки «Участие» на листе "+title)
            seen=set()
            for index,row in enumerate(league_rows[1:],5):
                if not row or not row[0]:
                    continue
                eid=str(row[0])
                if eid in seen:
                    raise AttendanceSheetError("Повтор ID игры на листе "+title)
                seen.add(eid)
                summary=snapshot["summaries"].get(eid)
                if summary is not None:
                    request=self.cells(league["sheetId"],index,6,[[summary["text"]]])
                    request["updateCells"]["rows"][0]["values"][0]["note"]=summary["note"]
                    request["updateCells"]["fields"]="userEnteredValue,note"
                    requests.append(request)
        # Only owned matrix cells and G summaries; existing schedule/formulas/notes stay in place.
        requests.extend([
            {"repeatCell":{"range":{"sheetId":sid,"startRowIndex":0,"endRowIndex":height,"startColumnIndex":0,"endColumnIndex":width},
                "cell":{"userEnteredFormat":{"wrapStrategy":"WRAP","verticalAlignment":"TOP"}},
                "fields":"userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment"}},
            {"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":4,"endIndex":width},
                "properties":{"pixelSize":220},"fields":"pixelSize"}},
            {"autoResizeDimensions":{"dimensions":{"sheetId":sid,"dimension":"ROWS","startIndex":2,"endIndex":max(3,height)}}}
        ] if width>4 and height>2 else [])
        new_headers_start=max(4,len(old[1]) if len(old)>1 else 4)
        if width>new_headers_start:
            requests.append({"copyPaste":{"source":{"sheetId":sid,"startRowIndex":0,"endRowIndex":1,"startColumnIndex":4,"endColumnIndex":5},
                "destination":{"sheetId":sid,"startRowIndex":0,"endRowIndex":1,"startColumnIndex":new_headers_start,"endColumnIndex":width},
                "pasteType":"PASTE_FORMAT"}})
        self.request("POST",":batchUpdate",fence,{"requests":requests})
