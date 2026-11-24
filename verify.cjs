// 외부 테스트 패키지 없이 핵심 로직을 검증합니다: node verify.cjs
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: '', checked: false, textContent: '', innerHTML: '', files: [],
    classList: {toggle(){}}, addEventListener(){}, showModal(){}, close(){}, reset(){},
    scrollIntoView(){}, removeAttribute(){}, querySelector(){return {onclick:null};}
  });
  return elements.get(id);
};
element('radius').value = '1000'; element('available').checked = true;
const chain = () => {
  const result = {};
  ['setView','addTo','on','bindTooltip','setLatLng','setRadius','clearLayers','panTo','closePopup','bindPopup','openPopup','invalidateSize'].forEach(k => result[k] = () => result);
  return result;
};
let saved = null, failSave = false;
const context = vm.createContext({
  console, structuredClone, crypto:require('node:crypto').webcrypto,
  setTimeout(){}, clearTimeout(){}, setInterval(){},
  document:{getElementById:element,querySelectorAll(){return [];},createElement(){return element('created');},addEventListener(){}},
  window:{addEventListener(){}},navigator:{},
  localStorage:{getItem(){return saved;},setItem(k,v){if(failSave)throw Error('quota');saved=v;}},
  L:{map:chain,control:{zoom:chain},tileLayer:chain,layerGroup:chain,marker:chain,circle:chain,divIcon:x=>x}
});
vm.runInContext(fs.readFileSync('dist/bins.js','utf8')+'\n'+fs.readFileSync('dist/app.js','utf8'),context);
const run = code => vm.runInContext(code,context);
assert(Math.abs(run('distance({lat:0,lng:0},{lat:0,lng:1})')-111195)<1);
assert.equal(run('visibleBins().length'),8);
run("reportFull('demo-1')");
assert.equal(run('visibleBins().length'),7);
assert.equal(run('nearestBin.id'),'demo-2');
const expires = run("state.full['demo-1'].expiresAt");
assert.equal(run("state.full['demo-1'].expiresAt-state.full['demo-1'].reportedAt"),86400000);
run("reportFull('demo-1')");
assert.equal(run("state.full['demo-1'].expiresAt"),expires);
run("state.full['demo-1'].expiresAt=Date.now()-1; expireFull(); render()");
assert.equal(run('visibleBins().length'),8);
assert.equal(run('nearestBin.id'),'demo-1');
// 저장 실패 시 상태를 바꾸지 않습니다.
failSave=true;
assert.equal(run("commit(s=>s.bins.push({id:'bad'}))"),false);
assert.equal(run('state.bins.length'),8); failSave=false;
// GPS 없는 사진, 먼 GPS, 중복 위치는 받지 않습니다.
element('bin-name').value='테스트 쓰레기통'; element('outdoor').checked=true;
element('latitude').value='37.55';element('longitude').value='126.95';
run("$('report-form').onsubmit({preventDefault(){}})");
assert.equal(run('state.reports.length'),0);
run("photoGPS={lat:37,lng:126};photoData='data:image/jpeg;base64,dGVzdA==';$('report-form').onsubmit({preventDefault(){}})");
assert.equal(run('state.reports.length'),0);
element('latitude').value='37.5663';element('longitude').value='126.9785';
run("photoGPS={lat:37.5663,lng:126.9785};$('report-form').onsubmit({preventDefault(){}})");
assert.equal(run('state.reports.length'),0);
// 위치 확인 후 검토 대기로 저장하고, 승인 전에는 보상을 주지 않습니다.
element('latitude').value='37.55';element('longitude').value='126.95';
run("photoGPS={lat:37.55,lng:126.95};$('report-form').onsubmit({preventDefault(){}})");
assert.equal(run('state.reports.length'),1);
assert.equal(run("state.reports[0].status"),'pending');
assert.equal(run('state.bins.length'),8);
assert.equal(element('report-count').textContent,0);
const reportID=run('state.reports[0].id');
context.reviewButton={dataset:{id:reportID,review:'approve'}};
run("$('review-list').onclick({target:{closest(){return reviewButton}}})");
assert.equal(run('state.bins.length'),9);
assert.equal(element('report-count').textContent,1);
run("$('review-list').onclick({target:{closest(){return reviewButton}}})");
assert.equal(run('state.bins.length'),9); // 중복 승인을 막습니다.
run("for(let i=0;i<4;i++)state.reports.push({id:'reward-'+i,name:'보상 확인',status:'approved',createdAt:Date.now()});renderActivity()");
assert.match(element('reward-text').textContent,/100P/);
assert.equal(element('report-count').textContent,5);
assert(JSON.parse(saved).reports.length>=1);
console.log('PASS: distance, filters, full/duplicate/24h expiry, storage rollback, GPS rejection, duplicate location, pending/approval, duplicate approval, rewards');
