"""Orbit Core ChatGPT MCP staging bridge. NOT a durable memory deployment."""
import os, json, sqlite3, hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

TOKEN=os.environ.get("ORBIT_MCP_TOKEN","")
DB=os.environ.get("ORBIT_DB_PATH","/tmp/orbit-core-staging.sqlite3")
if len(TOKEN)<32: raise RuntimeError("Set ORBIT_MCP_TOKEN (32+ chars)")
db=sqlite3.connect(DB,check_same_thread=False)
db.execute("""CREATE TABLE IF NOT EXISTS memories(project TEXT,key TEXT,kind TEXT,summary TEXT,source TEXT,importance INTEGER,status TEXT DEFAULT 'ACTIVE',updated TEXT,PRIMARY KEY(project,key))""")
db.commit()
SCHEMA={"type":"object","additionalProperties":False}
def tool(name, description, props, required):
 return {"name":name,"description":description,"inputSchema":dict(SCHEMA,properties=props,required=required)}
s=lambda n=200:{"type":"string","minLength":1,"maxLength":n}
TOOLS=[
tool("orbit_memory_save","Save one authorized project fact or decision. Storage on free Render can be EPHEMERAL; Notion remains canonical.",{"project":s(100),"key":s(160),"kind":{"type":"string","enum":["semantic","episodic","decision","procedural","checkpoint"]},"summary":s(3000),"source":s(300),"importance":{"type":"integer","minimum":1,"maximum":5}},["project","key","kind","summary","source"]),
tool("orbit_memory_recall","Recall one project's staging memories (not reliable cross-redeploy).",{"project":s(100),"query":{"type":"string","maxLength":200},"limit":{"type":"integer","minimum":1,"maximum":20}},["project"]),
tool("orbit_memory_archive","Archive an explicitly selected staged record, not permanent deletion.",{"project":s(100),"key":s(160),"reason":s(300)},["project","key","reason"]),
tool("orbit_decision_choose","Return a bounded first-party recommendation, never execute it.",{"options":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"object"}}},["options"]),
tool("orbit_gate_evaluate","Gate outcome from supplied check evidence, not independent CI verification.",{"checks":{"type":"array","minItems":1}},["checks"])
]
def invoke(name,a):
 if name=="orbit_memory_save":
  kind=a["kind"]; importance=a.get("importance",3)
  if kind not in ["semantic","episodic","decision","procedural","checkpoint"] or type(importance)!=int or not 1<=importance<=5:raise ValueError("Invalid memory type or importance")
  params=(a["project"],a["key"],kind,a["summary"],a["source"],importance,datetime.now(timezone.utc).isoformat())
  with db: db.execute("INSERT INTO memories(project,key,kind,summary,source,importance,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project,key) DO UPDATE SET kind=excluded.kind,summary=excluded.summary,source=excluded.source,importance=excluded.importance,status='ACTIVE',updated=excluded.updated",params)
  return {"saved":True,"project":a["project"],"key":a["key"],"durable":False}
 if name=="orbit_memory_recall":
  q=a.get("query","").lower();lim=max(1,min(int(a.get("limit",8)),20))
  rows=db.execute("SELECT project,key,kind,summary,source,importance,status,updated FROM memories WHERE project=? AND status='ACTIVE' ORDER BY importance DESC,updated DESC LIMIT 250",(a["project"],)).fetchall()
  return [dict(zip(["project","key","kind","summary","source","importance","status","updated"],r)) for r in rows if q in (r[1]+" "+r[3]).lower()][:lim]
 if name=="orbit_memory_archive":
  if not a.get("reason"):raise ValueError("Reason required")
  with db:cur=db.execute("UPDATE memories SET status='ARCHIVED' WHERE project=? AND key=?",(a["project"],a["key"]))
  return {"archived":cur.rowcount>0}
 if name=="orbit_decision_choose":
  options=a["options"]
  if not isinstance(options,list) or not 1<=len(options)<=12:raise ValueError("Expected 1-12 options")
  valid=[]
  for op in options:
   if not isinstance(op,dict) or not op.get("id") or not op.get("label"):raise ValueError("Each option needs id and label")
   if op.get("policy_allowed",True) is False or op.get("tool_available",True) is False:continue
   val=op.get("value",0);e=op.get("evidence",0)
   if type(val)!=int or type(e)!=int or not(0<=val<=5 and 0<=e<=5):raise ValueError("Invalid 0-5 score")
   risk=op.get("risk","medium")
   if risk not in ["low","medium","high"]:raise ValueError("Invalid risk")
   score=3*val+2*e-{"low":0,"medium":3,"high":7}[risk]
   valid.append((score,op))
  if not valid:return {"status":"BLOCKED","reason":"No eligible option"}
  _,best=sorted(valid,key=lambda x:(-x[0],x[1]["id"]))[0]
  status="NEEDS_EVIDENCE" if best.get("evidence",0)==0 else "RECOMMEND_ONLY" if best.get("risk","medium")=="high" or best.get("requires_approval",False) or best.get("reversible",True) is False else "SELECTED"
  return {"status":status,"choice_id":best["id"],"note":"Recommendation only. No execution or permission implied."}
 if name=="orbit_gate_evaluate":
  checks=a["checks"]
  if not isinstance(checks,list) or not checks:raise ValueError("At least one check required")
  statuses=[v.get("status") for v in checks]
  if any(t not in ["PASS","FAIL","NOT_RUN"] for t in statuses):raise ValueError("Invalid check")
  if any(v["status"]=="PASS" and not v.get("evidence") for v in checks):raise ValueError("PASS requires an evidence reference")
  gate="REWORK" if "FAIL" in statuses else "HOLD" if "NOT_RUN" in statuses else "GO"
  return {"gate":gate,"basis":"Caller-supplied check statuses, not independent verification"}
 raise ValueError("Unknown tool")
class Handler(BaseHTTPRequestHandler):
 def reply(self,status,obj):
  raw=b"" if obj is None else json.dumps(obj).encode()
  self.send_response(status);self.send_header("Content-Type","application/json")
  self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)));self.end_headers()
  if raw:self.wfile.write(raw)
 def do_GET(self):
  if self.path=="/health":self.reply(200,{"ok":True,"storage":"ephemeral-staging"})
  else:self.reply(405,{"error":"GET not supported"})
 def do_POST(self):
  if self.path!="/mcp":return self.reply(404,{"error":"not found"})
  if not hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+TOKEN):return self.reply(401,{"error":"unauthorized"})
  origin=self.headers.get("Origin","")
  if origin and origin not in ("https://chatgpt.com","https://chat.openai.com"):return self.reply(403,{"error":"origin blocked"})
  size=int(self.headers.get("Content-Length","0"))
  if size<=0 or size>65536:return self.reply(413,{"error":"bad request size"})
  try:
   p=json.loads(self.rfile.read(size));mid=p.get("id");method=p.get("method");arg=p.get("params") or {}
   if p.get("jsonrpc")!="2.0" or not isinstance(method,str):raise ValueError("Bad JSON-RPC")
   if mid is None:return self.reply(202,None)
   if method=="initialize":out={"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"orbit-core-staging","version":"0.12.0"}}
   elif method=="ping":out={}
   elif method=="tools/list":out={"tools":TOOLS}
   elif method=="tools/call":
    name=arg.get("name");a=arg.get("arguments") or {}
    if name not in {t["name"] for t in TOOLS}:raise ValueError("Unknown tool")
    schema=next(t["inputSchema"] for t in TOOLS if t["name"]==name)
    if not isinstance(a,dict) or any(k not in a for k in schema["required"]) or set(a)-set(schema["properties"]):raise ValueError("Invalid arguments")
    for k,v in a.items():
     if isinstance(v,str) and len(v)>4000:raise ValueError("Text too long")
    value=invoke(name,a);out={"content":[{"type":"text","text":json.dumps(value)}],"isError":False}
   else:return self.reply(200,{"jsonrpc":"2.0","id":mid,"error":{"code":-32601,"message":"Method not found"}})
   self.reply(200,{"jsonrpc":"2.0","id":mid,"result":out})
  except Exception as exc:self.reply(200,{"jsonrpc":"2.0","id":locals().get("mid"),"error":{"code":-32602,"message":"Invalid request"}})
 def log_message(self,*_):pass
if __name__=="__main__":
 port=int(os.environ.get("PORT","10000"))
 print("Starting Orbit MCP STAGING (ephemeral storage)",flush=True)
 ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
