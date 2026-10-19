#!/usr/bin/env python3
"""Install an existing service-account JSON into the external server environment."""
import argparse
import json
import os
from pathlib import Path
import tempfile

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("key_file",type=Path)
    parser.add_argument("--env",type=Path,default=Path("/etc/sechenov-volley-bot.env"))
    args=parser.parse_args()
    if args.env.is_symlink() or not args.env.is_file():
        raise ValueError("Use an existing regular external environment file")
    if args.key_file.is_symlink() or not args.key_file.is_file():
        raise ValueError("Use a regular service account key file")
    repository=Path(__file__).resolve().parents[1]
    if args.env.resolve().is_relative_to(repository) or args.key_file.resolve().is_relative_to(repository):
        raise ValueError("Environment secrets must stay outside the Git checkout")
    info=json.loads(args.key_file.read_text(encoding="utf-8"))
    if info.get("type")!="service_account" or info.get("token_uri")!="https://oauth2.googleapis.com/token":
        raise ValueError("Expected a Google service account key")
    if not all(info.get(key) for key in ("client_email","private_key","private_key_id")):
        raise ValueError("The service account key is incomplete")
    lines=[line for line in args.env.read_text(encoding="utf-8").splitlines()
        if line.partition("=")[0].strip()!="GOOGLE_SERVICE_ACCOUNT_JSON"]
    lines.append("GOOGLE_SERVICE_ACCOUNT_JSON="+json.dumps(info,ensure_ascii=True,separators=(",",":")))
    descriptor,temporary=tempfile.mkstemp(prefix=".volley-google-",dir=args.env.parent)
    try:
        os.fchmod(descriptor,0o600)
        with os.fdopen(descriptor,"w",encoding="utf-8") as output:
            output.write("\n".join(lines)+"\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary,args.env)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Google credentials installed in the external environment file.")
    print("Share the spreadsheet with:",info["client_email"])
    print("Recreate the bot process/container to load the new environment.")

if __name__=="__main__":
    main()
