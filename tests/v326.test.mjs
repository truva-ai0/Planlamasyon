import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverOpenOfficialZoning } from '../netlify/functions/lib/open-official-source-client.mjs';
import { enhanceZoningWithPlanAI } from '../netlify/functions/lib/plan-ai-client.mjs';
import { parseJsonBody } from '../netlify/functions/lib/http.mjs';
import { handler as planAiHandler } from '../netlify/functions/plan-ai.mjs';

const parcel = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[28.99,41.06],[29.00,41.06],[29.00,41.07],[28.99,41.07],[28.99,41.06]]] },
  properties: { province:'İstanbul', district:'Şişli', neighbourhood:'Mecidiyeköy', block:'1946', parcel:'70', area:223404 }
};
const query = { province:'İstanbul', district:'Şişli', neighbourhood:'Mecidiyeköy', block:'1946', parcel:'70' };

function response(body, status=200, headers={}) {
  return new Response(body, { status, headers: { 'content-type':'text/html; charset=utf-8', ...headers } });
}

test('izinli belediye e-imar fikstürünü ada/parsel ile gönderip doğrulanmış alanları çıkarır', async () => {
  const requests=[];
  const html=`<html><body><form method="post" action="/imardurum/">
    <input type="hidden" name="__VIEWSTATE" value="abc">
    <input name="txtAda"><input name="txtParsel">
    <button name="btnSorgula" value="Sorgula">Sorgula</button>
  </form></body></html>`;
  const resultHtml=`<html><body><h1>Online İmar Durumu</h1><div>Ada: 1946</div><div>Parsel: 70</div>
    <div>Plan Fonksiyonu: Ticaret Alanı</div><div>Emsal: 2,50</div><div>Yençok: 25 kat</div><div>Yapı Nizamı: Ayrık</div>
    <div>Ön Bahçe Mesafesi: 5 m</div><div>Yan Bahçe Mesafesi: 3 m</div></body></html>`;
  const fetchImpl=async (url,init={})=>{
    requests.push({url:String(url),method:init.method||'GET',body:init.body||''});
    if ((init.method||'GET')==='POST') return response(resultHtml);
    if (String(url).includes('example.gov.tr')) return response(html);
    return response('',404);
  };
  const providerDiscovery={ actions:[{ id:'authorized-fixture', title:'İzinli Belediye İmar Fikstürü', provider:'Test Belediyesi', url:'https://example.gov.tr/imardurum/', kind:'configured-adapter', accessMode:'authorized-adapter', machineReadableCandidate:true, configured:true, authorized:true, automatedQueryAllowed:true }] };
  const result=await discoverOpenOfficialZoning({ parcel, query, providerDiscovery, fetchImpl, env:{ OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES:1, OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS:5000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS:3000, OPEN_OFFICIAL_SOURCE_CACHE_DISABLED:'true' } });
  assert.equal(result.status,'available');
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].fields.emsal,2.5);
  assert.equal(result.records[0].fields.landUse,'Ticaret Alanı');
  assert.equal(result.records[0].fields.floors,25);
  assert.equal(result.records[0].fields.frontSetback,5);
  assert.equal(result.records[0].fields.sideSetback,3);
  assert.equal(result.records[0].source.trust,'verified');
  assert.ok(result.aiEvidence?.length >= 1);
  const post=requests.find(x=>x.method==='POST');
  assert.ok(post);
  assert.match(post.body,/txtAda=1946/);
  assert.match(post.body,/txtParsel=70/);
  assert.match(post.body,/__VIEWSTATE=abc/);
});

test('yanlış ada/parsel yazan portal sonucu yapılaşma hesabına uygulanmaz', async () => {
  const html=`<form method="post"><input name="Ada"><input name="Parsel"><input type="submit" name="Ara" value="Ara"></form>`;
  const wrong=`<div>Ada: 999</div><div>Parsel: 1</div><div>Emsal: 4.00</div>`;
  const fetchImpl=async (_url,init={})=> response((init.method||'GET')==='POST'?wrong:html);
  const providerDiscovery={ actions:[{ id:'portal', title:'Resmî portal', provider:'Belediye', url:'https://example.gov.tr/imar/', kind:'municipality-portal', accessMode:'public-portal', machineReadableCandidate:true }] };
  const result=await discoverOpenOfficialZoning({ parcel, query, providerDiscovery, fetchImpl, env:{ OPEN_OFFICIAL_SOURCE_MAX_CANDIDATES:1, OPEN_OFFICIAL_SOURCE_TOTAL_BUDGET_MS:3000, OPEN_OFFICIAL_SOURCE_TIMEOUT_MS:2000, OPEN_OFFICIAL_SOURCE_CACHE_DISABLED:'true' } });
  assert.equal(result.records.length,0);
  assert.equal(result.aiEvidence.length,0);
});

test('Plan AI açık kaynak taramasından hazır resmî metni yeniden indirmeden NVIDIAya gönderir', async () => {
  let nvidiaCalls=0; let otherCalls=0;
  const fetchImpl=async (url,init={})=>{
    if (String(url).includes('integrate.api.nvidia.com')) {
      nvidiaCalls++;
      const payload=JSON.parse(init.body);
      assert.equal(payload.messages[0].role,'system');
      const prompt=payload.messages.at(-1).content;
      assert.match(prompt,/Emsal: 2,50/);
      return new Response(JSON.stringify({ choices:[{message:{content:JSON.stringify({ parcelMatch:'exact', currentness:'current', primarySourceUrl:'https://kentrehberi.sisli.bel.tr/imardurum/imar.aspx?parselid=1', fields:{landUse:'Ticaret Alanı',emsal:2.5,floors:25}, fieldEvidence:{landUse:{sourceUrl:'https://kentrehberi.sisli.bel.tr/imardurum/imar.aspx?parselid=1',quote:'Plan Fonksiyonu: Ticaret Alanı'},emsal:{sourceUrl:'https://kentrehberi.sisli.bel.tr/imardurum/imar.aspx?parselid=1',quote:'Emsal: 2,50'},floors:{sourceUrl:'https://kentrehberi.sisli.bel.tr/imardurum/imar.aspx?parselid=1',quote:'Yençok: 25 kat'}} })}}], usage:{} }),{status:200,headers:{'content-type':'application/json'}});
    }
    otherCalls++; return new Response('',{status:500});
  };
  const evidenceText='Şişli Belediyesi Online İmar Durumu\nAda: 1946\nParsel: 70\nPlan Fonksiyonu: Ticaret Alanı\nEmsal: 2,50\nYençok: 25 kat';
  const result=await enhanceZoningWithPlanAI({ parcel, query, providerDiscovery:{actions:[{url:'https://example.gov.tr'}]}, openSourceScan:{ aiEvidence:[{id:'e1',title:'Şişli Belediyesi',provider:'Şişli Belediyesi',url:'https://kentrehberi.sisli.bel.tr/imardurum/imar.aspx?parselid=1',kind:'official-portal-result',parcelMatch:'exact',text:evidenceText}] }, env:{NVIDIA_API_KEY:'test-key',PLAN_AI_CACHE_DISABLED:'true',PLAN_AI_TIMEOUT_MS:3000}, fetchImpl });
  assert.equal(nvidiaCalls,1);
  assert.equal(otherCalls,0);
  assert.equal(result.status,'applied');
  assert.equal(result.fields.emsal,2.5);
  assert.equal(result.canCalculate,true);
});

test('Cloudflare ortamında Buffer olmadan JSON body okunur', () => {
  const prior=globalThis.Buffer;
  try {
    globalThis.Buffer=undefined;
    const data=JSON.stringify({question:'Merhaba',analysis:{status:'partial'}});
    const base64=btoa(unescape(encodeURIComponent(data)));
    assert.deepEqual(parseJsonBody({body:base64,isBase64Encoded:true}), JSON.parse(data));
  } finally { globalThis.Buffer=prior; }
});

test('Plan AI endpointi NVIDIA 401 hatasında sınırlı güvenli cevap döndürür', async () => {
  const priorFetch=globalThis.fetch;
  try {
    globalThis.fetch=async ()=>new Response('{"error":"bad key"}',{status:401,headers:{'content-type':'application/json'}});
    const result=await planAiHandler({httpMethod:'POST',headers:{'cf-connecting-ip':'127.0.0.2'},body:JSON.stringify({question:'Buraya bina yapılır mı?',analysis:{status:'partial'}}),isBase64Encoded:false},{cloudflareEnv:{NVIDIA_API_KEY:'bad-key',PLAN_AI_CACHE_DISABLED:'true'}});
    const body=JSON.parse(result.body);
    assert.equal(result.statusCode,200);
    assert.equal(body.ok,true);
    assert.equal(body.data.degraded,true);
    assert.equal(body.data.errorCode,'PLAN_AI_UNAUTHORIZED');
    assert.match(body.data.answer,/doğrulanmış|doğrulanamadı/i);
  } finally { globalThis.fetch=priorFetch; }
});
