@echo off
set PYTHONIOENCODING=utf-8
"C:\Users\24219\AppData\Local\Python\pythoncore-3.14-64\python.exe" "S:\Projects\projects_new\skills\alarm-disposal-orchestrator\scripts\orchestrate.py" %* > "S:\Projects\projects_new\skills\alarm-disposal-orchestrator\output.json"
"C:\Users\24219\AppData\Local\Python\pythoncore-3.14-64\python.exe" -c "import json; d=json.load(open('S:/Projects/projects_new/skills/alarm-disposal-orchestrator/output.json',encoding='utf-8')); d.pop('visual_base64',None); dispatch=d.get('dispatch',{}); data=dispatch.get('data',{}); data.pop('visual_base64',None); print(json.dumps(d,ensure_ascii=False,indent=2))"
