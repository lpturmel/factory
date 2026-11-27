"""Shared helpers for the factory scripts. Python 3 stdlib only.

Every script lives in <project>/factory/bin/ of the MAIN checkout and is always
invoked from there, so ROOT is the main checkout even when the work happens in
a job worktree.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(os.environ.get("FACTORY_ROOT") or Path(__file__).resolve().parents[2])
FACTORY = ROOT / "factory"
JOBS = FACTORY / "jobs"
CONFIG_PATH = FACTORY / "config.json"
RISKS = ["low", "medium", "high"]


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def die(msg, code=2):
    print("ERROR " + msg)
    sys.exit(code)


def load_config():
    try:
        return json.loads(CONFIG_PATH.read_text())
    except FileNotFoundError:
        die("no factory/config.json at %s" % CONFIG_PATH)
    except json.JSONDecodeError as e:
        die("factory/config.json is not valid JSON: %s" % e)


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=path.suffix)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, str(path))


def atomic_write_json(path, obj):
    atomic_write(path, json.dumps(obj, indent=2, sort_keys=False) + "\n")


def summary_md(bullets, body=""):
    """A script-written stage file: ## Summary with 3-5 bullets, then body."""
    bullets = [b for b in bullets if b][:5]
    while len(bullets) < 3:
        bullets.append("-")
    out = "## Summary\n\n" + "".join("- %s\n" % b for b in bullets)
    if body:
        out += "\n" + body.rstrip() + "\n"
    return out


# ---------- front matter (local backlog files) ----------

FM_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


def parse_front_matter(text):
    m = FM_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end():]


def set_front_matter_key(text, key, value):
    m = FM_RE.match(text)
    if not m:
        return "---\n%s: %s\n---\n%s" % (key, value, text)
    lines = m.group(1).splitlines()
    for i, line in enumerate(lines):
        if line.split(":", 1)[0].strip() == key:
            lines[i] = "%s: %s" % (key, value)
            break
    else:
        lines.append("%s: %s" % (key, value))
    return "---\n" + "\n".join(lines) + "\n---\n" + text[m.end():]


# ---------- models ----------

def resolve_model(alias, config):
    aliases = (config.get("models") or {}).get("aliases") or {}
    return aliases.get(alias, alias)


def model_for_risk(model, risk):
    """A reviewer's model is an alias, or {risk: alias}."""
    if isinstance(model, dict):
        if risk in model:
            return model[risk]
        # fall back to the nearest lower risk, then anything
        for r in reversed(RISKS[: RISKS.index(risk) + 1] if risk in RISKS else []):
            if r in model:
                return model[r]
        return next(iter(model.values()))
    return model


# ---------- routing ----------

def reviewer_matches(when, risk, surfaces):
    whens = when if isinstance(when, list) else [when]
    for w in whens:
        if w == "always":
            return True
        if w in RISKS:
            if risk in RISKS and RISKS.index(risk) >= RISKS.index(w):
                return True
        elif w in surfaces:
            return True
    return False


def route(config, risk, surfaces):
    out = []
    for r in config.get("reviewers") or []:
        if reviewer_matches(r.get("when", "always"), risk, surfaces):
            alias = model_for_risk(r.get("model", "sonnet"), risk)
            out.append({"name": r["name"], "model": alias, "model_id": resolve_model(alias, config)})
    return out


# ---------- shell ----------

def run(cmd, cwd=None, check=False, input=None, timeout=None, env=None):
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, input=input, text=True,
                       capture_output=True, timeout=timeout, env=env)
    if check and p.returncode != 0:
        raise RuntimeError("%s failed (%d): %s" % (" ".join(cmd), p.returncode,
                                                    (p.stderr or p.stdout).strip()[-800:]))
    return p


def git(*args, cwd=None, check=True):
    return run(["git"] + list(args), cwd=cwd or ROOT, check=check)


def section(text, heading):
    """Body of '## <heading>' up to the next '## ' heading, or None."""
    m = re.search(r"^##\s+%s\s*$(.*?)(?=^##\s|\Z)" % re.escape(heading), text, re.M | re.S)
    return m.group(1).strip() if m else None


def verdict(text, key, allowed):
    m = re.search(r"^\s*\**%s\**\s*:\s*\**\s*([A-Za-z-]+)" % re.escape(key), text, re.M)
    if not m:
        return None
    v = m.group(1).upper()
    return v if v in allowed else None
