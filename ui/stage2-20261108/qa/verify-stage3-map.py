"""Verify stage3 DOM/API map and locked file hashes; does not call real APIs."""
from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
md=(ROOT/'DOM_EVENT_API_MAP.md').read_text('utf8')
files={name:(ROOT/name).read_text('utf8') for name in ('前台.html','手机端.html','后台.html')}
manifest=json.loads((ROOT/'qa/manifest.json').read_text('utf8'))
for name,source in files.items():
    assert hashlib.sha256(source.encode()).hexdigest()==manifest['stage3']['file_sha256'][name], 'SHA mismatch: '+name

front,mobile,admin=files.values()
front_ids=['tb-ord','tb-hold','tb-watch','tb-req','m-trade','f-dep','f-id','f-bank','f-chat','tr-go']
admin_ids=['p-over','p-cli','p-appr','p-fund','p-cat','m-mir','m-ap','m-det','m-sub','m-sec','m-ed','m-chat','m-subpass','m-sublock','m-com','m-cf']
mobile_events=['login','logout','tab','open','buy','place','cancelo','fav','submit','ksub','bsub','chat','send','qa','rg','mode','reset']
def present_id(source,name):
    return bool(re.search(r'\bid=["\x27]'+re.escape(name)+r'["\x27]',source))
for name in front_ids:
    assert present_id(front,name) and '#'+name in md,'missing front mapping '+name
for name in admin_ids:
    assert present_id(admin,name) and '#'+name in md,'missing admin mapping '+name
for name in mobile_events:
    assert name in md,'missing mobile mapping '+name
    assert ("a==='"+name+"'") in mobile or ('data-a="'+name+'"') in mobile or ("chip('"+name+"'") in mobile or ("'"+name+"'") in mobile,'missing mobile action '+name
for endpoint in ['/api/account','/api/account/analytics','/api/orders','/api/requests','/api/private-data','/api/support','/api/admin/me']:
    assert endpoint in md,'missing API contract '+endpoint
for text in ['未直接接此实际 API','不能将客户 cookie 当管理员身份','后台新设计是 **5 页 + 11 弹窗**']:
    assert text in md,'missing safety note '+text
print('UI_STAGE3_DOM_API_MAP_OK: 3 SHA, 10 front controls, 17 mobile actions, 16 admin controls, 7 API families')
