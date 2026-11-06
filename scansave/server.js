'use strict';
const http = require('node:http');
const comparison=require('./compare');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 10000);
const ORIGIN = 'https://scansave-beta.onrender.com';
const UA = 'ScanSaveBeta/0.3 (public barcode lookup; https://scansave-beta.onrender.com)';
const cache = new Map();
const requestLog = new Map();
const msDay = 86400000;
let upcLastRequest=0,upcCooldownUntil=0,upcDailyCount=0,upcDayKey='';
function limitUPCRequests(){
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
  if(day!==upcDayKey){upcDayKey=day;upcDailyCount=0;upcCooldownUntil=0}
  if(now<upcCooldownUntil||now-upcLastRequest<11000||upcDailyCount>=90){
    const e=new Error('UPC_SOURCE_LIMIT');e.status=429;throw e;
  }
  upcLastRequest=now;upcDailyCount++;
}
function json(res,status,data,origin){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin==='https://scansave-beta.onrender.com'?ORIGIN:ORIGIN,'Vary':'Origin','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function codeOK(s){return /^\d{8,14}$/.test(s||'')}
function text(s,n=180){return String(s==null?'':s).slice(0,n).trim()}
function usdPrice(p){return Number.isFinite(Number(p))&&Number(p)>0?Math.round(Number(p)*100)/100:null}
async function requestJSON(url, timeout=5500,headers={}){
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),timeout);
  try{
   const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':UA,...headers},signal:ac.signal,redirect:'error'});
   if(!r.ok){const e=new Error('SOURCE_HTTP_'+r.status);e.status=r.status;throw e}
   const raw=await r.text();if(raw.length>2500000)throw new Error('SOURCE_TOO_LARGE');
   return JSON.parse(raw);
  }finally{clearTimeout(timer)}
}
function cached(key,ttl,producer){
 const e=cache.get(key);if(e&&e.exp>Date.now())return e.pending||Promise.resolve(e.data);
 const pending=Promise.resolve().then(producer).then(data=>{cache.set(key,{data,exp:Date.now()+ttl});return data}).catch(err=>{cache.delete(key);throw err});
 cache.set(key,{pending,exp:Date.now()+15000});if(cache.size>500)cache.delete(cache.keys().next().value);
 return pending;
}
async function catalog(code){
 try{
  const body=await cached('upc:'+code,4*3600000,async()=>{
   limitUPCRequests();
   try{return await requestJSON('https://api.upcitemdb.com/prod/trial/lookup?upc='+encodeURIComponent(code),6500)}
   catch(e){if(e.status===429)upcCooldownUntil=Date.now()+15*60000;throw e}
  });
  const item=Array.isArray(body.items)?body.items.find(i=>[i.ean,i.upc,i.gtin].map(String).some(v=>v.replace(/^0+/,'')===code.replace(/^0+/,''))):null;
  if(!item)return {status:'not_found',product:null,offers:[]};
  const now=Date.now();
  const offers=(Array.isArray(item.offers)?item.offers:[]).flatMap(o=>{
   const price=usdPrice(o.price),updated=Number(o.updated_t)*1000;
   let u;try{u=new URL(o.link)}catch{return []}
   if(u.protocol!=='https:'||!['www.upcitemdb.com','upcitemdb.com'].includes(u.hostname))return [];
   if(!price||!Number.isFinite(updated)||updated<=0||updated>now+msDay||now-updated>30*msDay)return [];
   if(/out.of.stock|unavailable/i.test(o.availability||''))return [];
   if(o.currency&&!['USD','$'].includes(o.currency.toUpperCase()))return [];
   const list=usdPrice(o.list_price);
   return [{
    merchant:text(o.merchant,70),title:text(o.title,160),price,prior_listed_price:list&&list>price?list:null,
    last_updated:new Date(updated).toISOString().slice(0,10),url:u.href,
    currency:o.currency||'unspecified',price_kind:'unconfirmed_merchant_listing',
    currency_note:o.currency?'USD quoted by source':'Currency not specified by source; verify USD with merchant'
   }];
  }).sort((a,b)=>a.price-b.price).slice(0,12);
  const title=text(item.title,170),brand=text(item.brand,100);
  const image=Array.isArray(item.images)?item.images.find(x=>/^https:\/\//.test(x)):null;
  return {status:'ok',product:{title,brand,image,code},offers};
 }catch(err){return {status:err.status===429?'rate_limited':'unavailable',product:null,offers:[]}}
}
async function openPrices(code){
 try{
  const params=new URLSearchParams({product_code:code,currency:'USD',order_by:'-date',size:'25'});
  const response=await cached('prices:'+code,3600000,()=>requestJSON('https://prices.openfoodfacts.org/api/v1/prices?'+params.toString(),6500));
  const now=Date.now();const items=(Array.isArray(response.items)?response.items:[]).flatMap(p=>{
    const price=usdPrice(p.price);const age=Date.parse(p.date+'T00:00:00Z');
    const loc=p.location||{},country=text(loc.osm_address_country||loc.country,90);
    if(!price||p.currency!=='USD'||!Number.isFinite(age)||age>now+msDay||now-age>180*msDay)return [];
    if(country&&!/^(united states|united states of america|usa|us)$/i.test(country))return [];
    const before=usdPrice(p.price_without_discount);
    return [{price,currency:'USD',date:p.date,store:text(loc.osm_name||loc.osm_brand||'Location unlisted',100),city:text(loc.osm_address_city,80),price_without_discount:before&&before>price?before:null,kind:'crowdsourced_historical_observation',verified_current:false}];
  }).slice(0,15);
  return {status:'ok',observations:items,records_reported:Number(response.total)||0};
 }catch(err){return {status:'unavailable',observations:[]}}
}
async function lookup(code){
 const [c,p]=await Promise.all([catalog(code),openPrices(code)]);
 return {code,lookup_status:c.status,price_status:p.status,product:c.product,merchant_listings:c.offers,historical_prices:p.observations,
  disclaimers:['Merchant prices are reported listings, not guaranteed checkout prices.','Crowdsourced prices are dated observations, not live store shelf prices.','No automatic coupon redemption is available.'],
  providers:[{name:'UPCitemdb',status:c.status},{name:'Open Prices',status:p.status}],last_checked:new Date().toISOString()};
}

/* Product-specific coupon adapter. All codes must come from an authenticated provider,
   and only provider-verified recent codes may appear as VERIFIED. */
const STORE_DIRECTORY=require('./stores.json');
const SUPPORTED_HOSTS=[...new Set(STORE_DIRECTORY.map(s=>s.domain).filter(d=>/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
function parseRetailerURL(value){
 try{
  if(typeof value!=='string'||value.length>1800)return null;
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!u.pathname||u.pathname==='/')return null;
  const hostname=u.hostname.toLowerCase();
  if(!SUPPORTED_HOSTS.some(d=>hostname===d||hostname.endsWith('.'+d)))return null;
  // Strip tracking/query data; provider docs recommend canonical stable product URLs.
  return u.origin+u.pathname;
 }catch{return null}
}
function validHTTPS(value){
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:null;
 }catch{return null}
}
function normalizeSovrn(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.coupons)||!raw.scan||typeof raw.scan.verification_active!=='boolean'){
  return {status:'unavailable',sources_checked:0,offers:[],provider:'Sovrn',message:'Coupon provider returned an unexpected response'};
 }
 const scan=raw.scan,now=Date.now();
 const recent=[],older=[],seen=new Set();
 for(const c of raw.coupons){
  if(!c||typeof c!=='object'||c.verified!==true)continue;
  const href=validHTTPS(c.affiliated_url);
  if(!href||typeof c.code!=='string'||!c.code.trim())continue;
  const verifiedMillis=Date.parse(c.verified_at);
  if(!Number.isFinite(verifiedMillis)||verifiedMillis>now+msDay)continue;
  const daysOld=Math.floor((now-verifiedMillis)/msDay);
  const code=text(c.code,80);
  const id=text(c.id||code,110);
  const dedup=id+'|'+code;
  if(seen.has(dedup))continue;seen.add(dedup);
  const currency=c.currency==='USD'?'USD':null;
  const before=currency?usdPrice(c.original_price):null;
  const after=currency?usdPrice(c.price_with_code):null;
  const difference=before!==null&&after!==null&&before>after?Math.round((before-after)*100)/100:null;
  const row={
   id,code,title:'Verified promo code: '+code,
   description:text(c.code_description||'Product-specific promo code. Confirm eligibility at retailer checkout.',280),
   url:href,provider:'Sovrn',merchant:text(raw.merchant?.group_name||raw.merchant?.domain,120),
   currency:c.currency||null,verified:true,verified_at:new Date(verifiedMillis).toISOString(),
   verified_days_ago:daysOld,channel:'online_promo_code',original_price:before,price_with_code:after,
   potential_online_savings:difference,
   requires_checkout_confirmation:true,
   auto_redeemable:false
  };
  // Verification may have become stale: do not promote old codes as actively verified.
  if(daysOld<=30)recent.push(row);
  else older.push({...row,verified:false,stale:true,title:'Previously verified promo code: '+code});
 }
 recent.sort((a,b)=>((b.potential_online_savings||0)-(a.potential_online_savings||0)));
 const pending=scan.verification_active===true;
 const retry=Math.min(86400,Math.max(60,Number(scan.when_to_check_back)||3600));
 return {
  status:pending?'pending_verification':recent.length?'ok':'no_verified_offers',
  sources_checked:pending?0:1,
  offers:recent.slice(0,20),
  stale_candidates:older.slice(0,10),
  provider:'Sovrn',
  merchant:text(raw.merchant?.group_name||raw.merchant?.domain,120),
  verification_in_progress:pending,
  when_to_check_back:pending?retry:null,
  checked_at:new Date(now).toISOString(),
  message:pending?'The provider is still testing possible codes; no complete no-offers conclusion yet.'
    :'Coupon results apply to the supplied online product URL only. Confirm code eligibility at checkout.'
 };
}
async function couponOffers(productURL){
 const key=process.env.SOVRN_SECRET_KEY,apiKey=process.env.SOVRN_SITE_API_KEY;
 if(!key||!apiKey){
  return {status:'not_configured',sources_checked:0,offers:[],provider:'Sovrn',
   message:'Product-specific coupon verification requires a Sovrn-approved account and server-side keys.'};
 }
 const url=parseRetailerURL(productURL);
 if(!url){
  return {status:'product_url_required',sources_checked:0,offers:[],provider:'Sovrn',
   message:'Enter a canonical product page URL from one of the supported retailers.'};
 }
 try{
  const params=new URLSearchParams({api_key:apiKey,product_url:url,include_unverified:'false'});
  const raw=await cached('sovrn:'+url,1200000,
   ()=>requestJSON('https://viglink.io/coupons/product?'+params.toString(),8500,{'Authorization':'secret '+key}));
  const result=normalizeSovrn(raw);
  return {...result,product_url:url};
 }catch(e){
  return {status:e.status===401?'authorization_required':'unavailable',sources_checked:0,offers:[],
   provider:'Sovrn',message:'Verified coupon source could not complete the request.'};
 }
}


/* No-key deal discovery. This public feed contains merchant-wide promotions, NOT
   UPC-matched coupons, and is always kept separate from verified product codes. */
function cleanName(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function merchantForDeal(raw){
 const name=text(raw.merchant?.name||raw.merchant_name||raw.program?.name||raw.program_name||raw.brand||'',100);
 const label=cleanName(name);
 return STORE_DIRECTORY.find(s=>cleanName(s.name)===label||cleanName(s.domain)===label)||null;
}
function normalizePublicDeals(raw,productName,selectedStores){
 if(!raw||!Array.isArray(raw.results))return {status:'unavailable',offers:[]};
 const now=Date.now(),wanted=new Set((selectedStores||[]).filter(s=>SUPPORTED_HOSTS.includes(s.domain)).map(s=>s.id));
 const all=!wanted.size,queryWords=text(productName,150).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>4);
 const output=[];
 for(const item of raw.results.slice(0,150)){
  if(!item||typeof item.title!=='string')continue;
  const store=merchantForDeal(item);
  if(!store)continue;
  if(!all&&!wanted.has(store.id))continue;
  // With all stores selected, show only title matches instead of unrelated merchant ads.
  if(all&&(!queryWords.length||!queryWords.some(w=>item.title.toLowerCase().includes(w))))continue;
  const expiry=Date.parse(item.valid_until||'');
  if(Number.isFinite(expiry)&&expiry<now)continue;
  let url;
  try{
   url=new URL(item.url||'', 'https://partners.clickwise.net');
   if(url.protocol!=='https:'||url.hostname!=='partners.clickwise.net')continue;
  }catch{continue}
  output.push({
   id:text(item.id,80),store:store.name,title:text(item.title,150),description:text(item.description||'',250),
   code:text(item.code||'',70),url:url.href,expires_at:Number.isFinite(expiry)?new Date(expiry).toISOString():null,
   provider:'Clickwise public deals',verified_for_product:false,
   kind:'merchant_wide_candidate',
   disclosure:'Merchant promotion only. Product eligibility and checkout redemption are not verified.',
   auto_redeemable:false
  });
  if(output.length>=10)break;
 }
 return {status:'ok',offers:output};
}
async function discoverPublicDeals(productName,selection){
 try{
  const raw=await cached('clickwise:public:en',10*60000,()=>requestJSON('https://partners.clickwise.net/api/v1/deals/?lang=en&page_size=50',6500));
  const selected=String(selection||'all')==='all'?[]:String(selection).split(',').map(id=>STORE_DIRECTORY.find(s=>s.id===id)).filter(Boolean);
  return normalizePublicDeals(raw,productName,selected);
 }catch(e){return {status:'unavailable',offers:[]}}
}

const server=http.createServer(async(req,res)=>{
 const host=new URL(req.url||'/', 'http://localhost');
 const origin=req.headers.origin||'';
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'});res.end();return}
 if(req.method!=='GET'){json(res,405,{error:'METHOD_NOT_ALLOWED'},origin);return}
 if(host.pathname==='/health'){json(res,200,{ok:true,app:'ScanSave API',
 comparison_connectors:comparison.RETAILERS.length,
 comparison_price_sources:['Open Prices','UPCitemdb'],
 retailer_product_page_reader:'robots-respecting structured data, requires exact barcode',coupon_provider_configured:!!(process.env.SOVRN_SECRET_KEY&&process.env.SOVRN_SITE_API_KEY),
 coupon_provider:'Sovrn product promo codes',coupon_source_status:(process.env.SOVRN_SECRET_KEY&&process.env.SOVRN_SITE_API_KEY)?'configured':'approval_or_keys_required',
 supported_retailer_urls:SUPPORTED_HOSTS.length,price_sources:['UPCitemdb','Open Prices']},origin);return}
 if(!['/api/lookup','/api/offers','/api/compare','/api/retailer-page'].includes(host.pathname)){json(res,404,{error:'NOT_FOUND'},origin);return}
 const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'anonymous').split(',')[0].trim();
 const t=Date.now();let record=requestLog.get(ip)||{t,used:0};if(t-record.t>60000)record={t,used:0};record.used++;requestLog.set(ip,record);
 if(record.used>20){json(res,429,{error:'RATE_LIMITED'},origin);return}
 if(requestLog.size>10000)requestLog.clear();
 try{
  if(host.pathname==='/api/compare'){
   const code=host.searchParams.get('code')||'';
   if(!codeOK(code)){json(res,400,{error:'INVALID_BARCODE'},origin);return}
   const data=await cached('comparison-source:'+code,120000,()=>lookup(code));
   const result=comparison.buildCompareResult(data,{
    code,stores:host.searchParams.get('stores')||'all',
    name:host.searchParams.get('name')||data.product?.title||'',
    baseline_price:host.searchParams.get('baseline_price')||''
   });
   const productURL=host.searchParams.get('product_url');
   if(productURL){
    result.retailer_page=await comparison.lookupRetailerPage(code,productURL);
    // Page price is a separate verified-GTIN source, never injected into guaranteed savings.
   }
   json(res,200,result,origin);return;
  }
  if(host.pathname==='/api/retailer-page'){
   const code=host.searchParams.get('code')||'';
   if(!codeOK(code)){json(res,400,{error:'INVALID_BARCODE'},origin);return}
   const url=host.searchParams.get('product_url')||'';
   const result=await comparison.lookupRetailerPage(code,url);
   json(res,200,result,origin);return;
  }
  if(host.pathname==='/api/lookup'){const code=host.searchParams.get('code')||'';if(!codeOK(code)){json(res,400,{error:'INVALID_BARCODE'},origin);return}
   const data=await lookup(code);json(res,200,data,origin);return}
  const [result,other]=await Promise.all([couponOffers(host.searchParams.get('product_url')||''),discoverPublicDeals(host.searchParams.get('q')||'',host.searchParams.get('stores')||host.searchParams.get('store')||'all')]);json(res,200,{...result,related_deals:other.offers,related_deal_feed_status:other.status},origin);
 }catch(e){json(res,503,{error:'DATA_SOURCES_UNAVAILABLE'},origin)}
});
if(require.main===module){server.listen(PORT,'0.0.0.0',()=>console.log('ScanSave API listening on '+PORT))}
module.exports={server,normalizeSovrn,parseRetailerURL,couponOffers,STORE_DIRECTORY,normalizePublicDeals,comparison};
