#!/usr/bin/env python3
"""Git credential helper for the server updater. Git consumes stdout privately."""
import os
import sys

if len(sys.argv)>1 and sys.argv[1]=="get":
    values=dict(line.rstrip("\n").split("=",1) for line in sys.stdin if "=" in line)
    token=os.environ.get("BOT_GITHUB_TOKEN","")
    if values.get("protocol")=="https" and values.get("host")=="github.com" and token:
        sys.stdout.write("username=x-access-token\npassword="+token+"\n\n")
