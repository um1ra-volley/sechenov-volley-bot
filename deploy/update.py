#!/usr/bin/env python3
"""Build a GitHub revision into an image, then switch/rollback on this Linux server."""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from bot import load_environment, redact

REPO="um1ra-volley/sechenov-volley-bot"

def run(args, *, env=None, capture=True):
    result=subprocess.run(args,cwd=ROOT,env=env,text=True,capture_output=capture)
    if result.returncode:
        raise RuntimeError("Command failed: "+args[0])
    return result.stdout.strip() if capture else ""

def save_json(path,data):
    temporary=path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data),encoding="utf-8")
    temporary.replace(path)

def compose(config,env,*args):
    return run(["docker","compose","--project-name","sechenov-volley-bot","-f",str(config),*args],env=env)

def deploy(retry_failed=False):
    secret_path=Path(os.environ.get("BOT_ENV_FILE","/etc/sechenov-volley-bot.env")).expanduser().resolve()
    if not secret_path.is_file():
        raise RuntimeError("Set BOT_ENV_FILE to the existing private secrets file")
    load_environment(secret_path)
    branch=os.environ.get("CODE_BRANCH","codex/python-server")
    if not re.fullmatch(r"codex/[A-Za-z0-9][A-Za-z0-9/-]*",branch):
        raise RuntimeError("Invalid CODE_BRANCH")
    state_dir=Path(os.environ.get("BOT_DEPLOY_STATE_DIR","/var/lib/sechenov-volley-deploy")).expanduser()
    state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    descriptor=os.open(state_dir/"update.lock",os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
    with os.fdopen(descriptor,"w") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another updater is active; skipped.")
            return
        remote=run(["git","remote","get-url","origin"])
        if remote not in ("https://github.com/"+REPO,"https://github.com/"+REPO+".git","git@github.com:"+REPO+".git"):
            raise RuntimeError("origin must point to the expected private GitHub repository")
        if run(["git","status","--porcelain"]):
            raise RuntimeError("Server checkout has local changes; preserve them before updating")
        if run(["git","branch","--show-current"])!=branch:
            raise RuntimeError("Check out CODE_BRANCH before enabling automatic deployment")
        environment={**os.environ,"BOT_ENV_FILE":str(secret_path)}
        helper="!python3 "+shlex.quote(str(ROOT/"deploy/git-credential.py"))
        ref="refs/remotes/origin/"+branch
        run(["git","-c","credential.helper=","-c","credential.helper="+helper,
             "fetch","--no-tags","origin","refs/heads/"+branch+":"+ref],env=environment)
        sha=run(["git","rev-parse",ref])
        if not re.fullmatch(r"[0-9a-f]{40}",sha):
            raise RuntimeError("Invalid code revision")
        active_file=state_dir/"active.json"
        failed_file=state_dir/"failed.json"
        active=json.loads(active_file.read_text()) if active_file.exists() else {}
        failed=json.loads(failed_file.read_text()) if failed_file.exists() else {}
        if failed.get("sha")==sha and not retry_failed:
            print("Candidate previously failed after switching; awaiting a new commit or --retry-failed.")
            return
        if not active:
            old_config=ROOT/"deploy/compose.yml"
            cid=compose(old_config,environment,"ps","-aq","bot")
            if cid:
                old_image=run(["docker","inspect","--format","{{.Config.Image}}",cid],env=environment)
                old_sha=run(["git","rev-parse","HEAD"])
                baseline_dir=state_dir/"releases"/("baseline-"+old_sha)
                baseline_dir.mkdir(parents=True,exist_ok=True)
                baseline_config=baseline_dir/"compose.yml"
                baseline_config.write_text(old_config.read_text(encoding="utf-8"),encoding="utf-8")
                active={"sha":old_sha,"image":old_image,"compose":str(baseline_config)}
                # Persist an immutable rollback target before checkout/cutover can change it.
                save_json(active_file,active)
        image="sechenov-volley-bot:"+sha
        candidate_dir=state_dir/"releases"/sha
        candidate_dir.mkdir(parents=True,exist_ok=True)
        candidate_config=candidate_dir/"compose.yml"
        candidate_config.write_text(run(["git","show",sha+":deploy/compose.yml"])+"\n",encoding="utf-8")
        if active.get("image")==image:
            print("The current GitHub revision is already deployed.")
            return
        archive=subprocess.Popen(["git","archive","--format=tar",sha],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            build=subprocess.run(["docker","build","-t",image,"-"],cwd=ROOT,stdin=archive.stdout,env=environment)
        finally:
            archive.stdout.close()
            archive.wait(timeout=30)
        if archive.returncode or build.returncode:
            raise RuntimeError("Candidate image could not be built; the running container was left in place")
        # Fast-forward only. Never reset/clean the checkout or touch the GitHub data branch.
        run(["git","merge","--ff-only",ref],env=environment)
        next_env={**environment,"BOT_IMAGE":image}
        try:
            compose(candidate_config,next_env,"up","-d","--no-build","--wait","--wait-timeout","240")
        except Exception:
            save_json(failed_file,{"sha":sha})
            if active.get("image"):
                previous_env={**environment,"BOT_IMAGE":active["image"]}
                compose(Path(active["compose"]),previous_env,"up","-d","--no-build","--wait","--wait-timeout","240")
                print("Previous image restored; GitHub business state was not rolled back.")
            raise RuntimeError("Candidate did not become healthy")
        save_json(active_file,{"sha":sha,"image":image,"compose":str(candidate_config)})
        if failed_file.exists():
            failed_file.unlink()
        print("Deployed "+sha+"; business data remains in the GitHub data branch.")

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--retry-failed",action="store_true")
    args=parser.parse_args()
    try:
        deploy(args.retry_failed)
    except Exception as exc:
        print(redact(str(exc)),file=sys.stderr)
        raise SystemExit(1)

if __name__=="__main__":
    main()
