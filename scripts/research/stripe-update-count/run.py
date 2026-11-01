"""Disposable PostgREST count fixture. Never use real payment data or credentials.

Run with the absolute path to this checkout's installed node_modules. Requires
trusted local Docker and preloaded postgres:17-alpine, postgrest/postgrest:v12.2.12,
and node:22-alpine images. Containers share an isolated network namespace with
no external networking and the database data is tmpfs. No images are pulled.
"""
import os, subprocess, tempfile, shutil, stat, time, sys
from pathlib import Path
if len(sys.argv) != 2:
 raise SystemExit('usage: python3 run.py /absolute/path/to/node_modules')
modules = Path(sys.argv[1])
if not modules.is_absolute(): raise SystemExit('node_modules path must be absolute')
modules = modules.resolve(strict=True)
if not (modules / '@supabase/supabase-js/package.json').is_file():
 raise SystemExit('supabase-js is not installed in the given node_modules')
socket='/var/run/docker.sock'
s=os.stat(socket)
if not stat.S_ISSOCK(s.st_mode) or s.st_uid != 0: raise SystemExit('local docker socket unavailable')
conf=tempfile.mkdtemp(prefix='sunrise-count-docker-')
base=['docker','--config',conf,'--host','unix:///var/run/docker.sock']
env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'}
ids=[]
def run(*args, input=None):
 r=subprocess.run(base+list(args),input=input,text=True,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);
 if r.returncode: print('fixture error:',r.stderr[-1800:]); raise RuntimeError('synthetic operation failed')
 return r.stdout.strip()
def start(*args):
 cid=run('run','-d','--pull=never','--log-driver=none',*args);ids.append(cid);return cid
try:
 for image in ['postgres:17-alpine','postgrest/postgrest:v12.2.12','node:22-alpine']:run('image','inspect',image)
 pg=start('--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic_test_password','postgres:17-alpine')
 ready=False
 for i in range(120):
  if subprocess.run(base+['exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0:ready=True;break
  time.sleep(.2)
 if not ready:raise RuntimeError('isolated PostgreSQL not ready')
 run('exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q',input='''CREATE ROLE synthetic_api NOLOGIN;
GRANT synthetic_api TO postgres;
CREATE TABLE public.payment_intents (stripe_pi_id text, status text);
INSERT INTO public.payment_intents VALUES ('synthetic_one','pending'), ('synthetic_two','pending'), ('synthetic_two','pending');
GRANT USAGE ON SCHEMA public TO synthetic_api;
GRANT SELECT, UPDATE ON public.payment_intents TO synthetic_api;
''')
 api=start('--network','container:'+pg,'-e','PGRST_DB_URI=postgres://postgres:synthetic_test_password@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=synthetic_api','-e','PGRST_JWT_SECRET=synthetic_secret_12345678901234567890','postgrest/postgrest:v12.2.12')
 js='''
const assert = require('node:assert/strict');
const { createClient } = require('/fixture/node_modules/@supabase/supabase-js');
const crypto = require('node:crypto');
const secret='synthetic_secret_12345678901234567890';
const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const unsigned=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role:'synthetic_api'});
const key=unsigned+'.'+crypto.createHmac('sha256',secret).update(unsigned).digest('base64url');
const client = createClient('http://127.0.0.1:3000',key,{global:{fetch:(url,opts)=>fetch(String(url).replace('/rest/v1',''),opts)}});
(async () => {
  for (let i = 0; i < 100; i++) {
    try { let r = await fetch('http://127.0.0.1:3000/'); if (r.ok) break; } catch {}
    await new Promise(r=>setTimeout(r,100));
    if (i===99) throw Error('PostgREST not ready');
  }
  for (const [id,expected] of [['synthetic_missing',0],['synthetic_one',1],['synthetic_two',2]]) {
    const {error,count} = await client.from('payment_intents').update({status:'succeeded'},{count:'exact'}).eq('stripe_pi_id',id);
    if(error) console.error("synthetic_error", error);
    assert.equal(error,null); assert.equal(count,expected);
    console.log('synthetic_exact_count='+count);
  }
})().catch((err)=>{console.error('synthetic count check failed:',err);process.exit(1)});
'''
 print(run('run','--rm','-i','--pull=never','--network','container:'+pg,'--log-driver=none','-v',str(modules)+':/fixture/node_modules:ro','node:22-alpine','node','-',input=js))
finally:
 for cid in reversed(ids):subprocess.run(base+['rm','-f',cid],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 shutil.rmtree(conf)
