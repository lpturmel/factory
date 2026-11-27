#!/usr/bin/env python3
"""install.py: stamp a software factory into a project. Python 3 stdlib only.

    install.py --project <dir> --answers <answers.json> [--templates <dir>] [--force] [--dry-run]

The factory-onboard skill interviews the user, writes answers.json, and runs
this. Templates default to <this file's real dir>/../../templates, so install
the skill as a symlink to the factory repo (see README).

answers.json:
{
  "name": "my-app",
  "backlog": "local" | "github",
  "github_repo": "owner/name" | null,
  "merge": "pr" | "local",
  "base_branch": "main",
  "concurrency": 3,
  "max_rounds": 4,
  "surfaces": {"ui": "description", ...},
  "reviewers": [{"name", "purpose", "model", "when", "focus"}],
  "checks": ["npm run lint", "npm test"],
  "models": {"intake": "fable", ...},            (optional)
  "permissions": true                            (optional: pre-approve what background agents need)
}

Writes: .claude/skills/factory/SKILL.md, .claude/agents/{intake,spec-writer,
builder,approver,<reviewer>...}.md, factory/bin/*, factory/config.json,
factory/checks.sh, factory/backlog/ (local), .gitignore entries, and the
project's entry in ~/.claude/factory/registry.json. Existing files are left
alone unless --force. Prints one line per file.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import stat
import sys
from pathlib import Path

FIXED_AGENTS = ["intake", "spec-writer", "builder", "approver"]
GITIGNORE = ["factory/jobs/", "factory/worktrees/"]
RISKS = ["low", "medium", "high"]
# Background subagents can't answer permission prompts, so an unattended run
# needs these pre-approved. Agents are told to use exactly these shapes.
ALLOW = [
    "Bash(factory/bin/job:*)",
    "Bash(factory/bin/backlog list)",
    "Bash(git -C:*)",
    "Bash(chmod +x:*)",
    "Read", "Glob", "Grep", "Edit", "Write",
]
# Older installs denied git push, which also blocked the user's own pushes
# from Claude. Updates remove exactly these entries; nothing is denied now.
LEGACY_DENY = ["Bash(git push:*)", "Bash(git -C * push:*)"]
NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def die(msg):
    print("ERROR " + msg)
    sys.exit(2)


class Installer:
    def __init__(self, project, templates, force, dry):
        self.p, self.t, self.force, self.dry = project, templates, force, dry

    def write(self, rel, text, mode=None):
        dst = self.p / rel
        if dst.exists() and not self.force:
            print("skip   %s (exists; --force to overwrite)" % rel)
            return
        print("%s %s" % ("would " if self.dry else "write ", rel))
        if self.dry:
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text)
        if mode:
            dst.chmod(mode)

    def copy(self, rel, dst_rel=None, executable=False):
        mode = 0o755 if executable else None
        self.write(dst_rel or rel, (self.t / rel).read_text(), mode)


def validate(a):
    for k in ("name", "backlog", "merge", "reviewers", "checks"):
        if k not in a:
            die("answers.json missing %r" % k)
    if a["backlog"] not in ("local", "github"):
        die("backlog must be local or github")
    if a["merge"] not in ("pr", "local"):
        die("merge must be pr or local")
    if a["merge"] == "pr" and a["backlog"] == "local" and not a.get("github_repo"):
        print("note   merge=pr needs a GitHub remote; gh will use the current repo's default")
    surfaces = set((a.get("surfaces") or {}).keys())
    seen = set()
    for r in a["reviewers"]:
        if not NAME_RE.match(r.get("name", "")) or r["name"] in FIXED_AGENTS or r["name"] in seen:
            die("bad or duplicate reviewer name %r" % r.get("name"))
        seen.add(r["name"])
        whens = r.get("when", "always")
        for w in whens if isinstance(whens, list) else [whens]:
            if w != "always" and w not in RISKS and w not in surfaces:
                die("reviewer %s: when=%r is not always, a risk level, or a surface" % (r["name"], w))


def describe_when(when):
    whens = when if isinstance(when, list) else [when]
    parts = []
    for w in whens:
        if w == "always":
            parts.append("on every job")
        elif w in RISKS:
            parts.append("at %s risk" % w if w == "high" else "at %s risk or higher" % w)
        else:
            parts.append("when the change touches the `%s` surface" % w)
    return " or ".join(parts)


MODEL_LINE_RE = re.compile(r"^model:.*$", re.M)


def stamp_model(text, alias):
    """Rewrite the `model:` line inside the leading frontmatter only."""
    if not alias or not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end < 0:
        return text
    head, rest = text[:end], text[end:]
    return MODEL_LINE_RE.sub(lambda m: "model: %s" % alias, head, count=1) + rest


def stamp_reviewer(tmpl, r):
    model = r.get("model", "sonnet")
    if isinstance(model, dict):
        # Routed per risk: the orchestrator always passes the model on spawn,
        # so a fixed frontmatter model could only disagree with it.
        out = tmpl.replace("model: {{MODEL}}\n", "")
    else:
        out = tmpl.replace("{{MODEL}}", model)
    for k, v in {
        "{{NAME}}": r["name"],
        "{{PURPOSE}}": r.get("purpose", "").strip().rstrip(".") + ".",
        "{{WHEN}}": describe_when(r.get("when", "always")),
        "{{FOCUS}}": (r.get("focus") or "- Anything within your purpose that must change before merging.").strip(),
    }.items():
        out = out.replace(k, v)
    return out


def checks_script(tmpl, cmds):
    lines = "\n".join("step bash -c %s" % shell_quote(c) for c in cmds) or 'step echo "no checks configured: edit factory/checks.sh"'
    return re.sub(r"# \{\{CHECKS\}\}\n.*\Z", lines + "\n", tmpl, flags=re.S)


def shell_quote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def build_config(tmpl, a):
    c = json.loads(tmpl)
    c["name"] = a["name"]
    c["backlog"] = a["backlog"]
    c["merge"] = a["merge"]
    c["github"]["repo"] = a.get("github_repo")
    for k in ("base_branch", "concurrency", "max_rounds", "merge_method", "remote"):
        if k in a:
            c[k] = a[k]
    if a.get("surfaces"):
        c["surfaces"] = a["surfaces"]
    if a.get("models"):
        c["models"]["agents"].update(a["models"])
    c["reviewers"] = [{k: r[k] for k in ("name", "purpose", "model", "when") if k in r} for r in a["reviewers"]]
    return json.dumps(c, indent=2) + "\n"


def update_gitignore(inst):
    path = inst.p / ".gitignore"
    have = path.read_text().splitlines() if path.exists() else []
    add = [g for g in GITIGNORE if g not in have]
    if not add:
        print("ok     .gitignore")
        return
    print("%s .gitignore (+%s)" % ("would " if inst.dry else "update", " ".join(add)))
    if not inst.dry:
        text = "\n".join(have).rstrip()
        path.write_text((text + "\n\n" if text else "") + "# software factory (local state)\n" + "\n".join(add) + "\n")


def update_settings(inst):
    path = inst.p / ".claude" / "settings.json"
    s = json.loads(path.read_text()) if path.exists() else {}
    perms = s.setdefault("permissions", {})
    allow = perms.setdefault("allow", [])
    want = ALLOW + ["Bash(%s/factory/bin/job:*)" % inst.p]  # agents sometimes use the absolute path
    add = [w for w in want if w not in allow]
    drop = [d for d in perms.get("deny", []) if d in LEGACY_DENY]
    if not add and not drop:
        print("ok     .claude/settings.json")
        return
    allow.extend(add)
    if drop:
        perms["deny"] = [d for d in perms["deny"] if d not in LEGACY_DENY]
        if not perms["deny"]:
            del perms["deny"]
    print("%s .claude/settings.json (+allow %s; -deny %s)" % ("would " if inst.dry else "update",
          ", ".join(add) or "-", ", ".join(drop) or "-"))
    if not inst.dry:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(s, indent=2) + "\n")


def register(a, project, dry):
    home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    reg_path = home / "factory" / "registry.json"
    reg = json.loads(reg_path.read_text()) if reg_path.exists() else {"version": 1, "projects": []}
    entry = {"name": a["name"], "path": str(project), "backlog": a["backlog"], "merge": a["merge"],
             "repo": a.get("github_repo"), "registered_at": now()}
    for i, e in enumerate(reg["projects"]):
        if e.get("path") == str(project):
            entry["registered_at"] = e.get("registered_at", entry["registered_at"])
            reg["projects"][i] = entry
            break
    else:
        names = {e.get("name") for e in reg["projects"]}
        n, base = 2, entry["name"]
        while entry["name"] in names:
            entry["name"] = "%s-%d" % (base, n)
            n += 1
        reg["projects"].append(entry)
    print("%s %s (%s)" % ("would " if dry else "register", reg_path, entry["name"]))
    if not dry:
        reg_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = reg_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(reg, indent=2) + "\n")
        os.replace(str(tmp), str(reg_path))


def main():
    ap = argparse.ArgumentParser(description="Install a software factory into a project.")
    ap.add_argument("--project", required=True)
    ap.add_argument("--answers", required=True)
    ap.add_argument("--templates", default=str(Path(__file__).resolve().parent.parent.parent / "templates"))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    o = ap.parse_args()
    project = Path(o.project).resolve()
    templates = Path(o.templates).resolve()
    if not (templates / "factory" / "bin" / "job").exists():
        die("templates not found at %s (pass --templates)" % templates)
    if not project.is_dir():
        die("project %s is not a directory" % project)
    a = json.loads(Path(o.answers).read_text())
    validate(a)
    inst = Installer(project, templates, o.force, o.dry_run)

    config = build_config((templates / "factory/config.json").read_text(), a)
    agent_models = json.loads(config).get("models", {}).get("agents", {})

    inst.copy(".claude/skills/factory/SKILL.md")
    for name in FIXED_AGENTS:
        rel = ".claude/agents/%s.md" % name
        inst.write(rel, stamp_model((templates / rel).read_text(), agent_models.get(name)))
    tmpl = (templates / ".claude/agents/reviewer.md").read_text()
    for r in a["reviewers"]:
        inst.write(".claude/agents/%s.md" % r["name"], stamp_reviewer(tmpl, r))
    for f in sorted((templates / "factory" / "bin").iterdir()):
        if f.is_file() and not f.name.startswith(".") and f.suffix != ".pyc":
            inst.copy("factory/bin/" + f.name, executable=True)
    inst.write("factory/config.json", config)
    inst.write("factory/checks.sh", checks_script((templates / "factory/checks.sh").read_text(), a["checks"]), 0o755)
    if a["backlog"] == "local":
        inst.copy("factory/backlog/EXAMPLE.md")
    update_gitignore(inst)
    if a.get("permissions"):
        update_settings(inst)
    register(a, project, o.dry_run)
    print("DONE factory installed in %s" % project)


if __name__ == "__main__":
    main()
