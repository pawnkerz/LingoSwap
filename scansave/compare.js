'use strict';
/*
 ScanSave comparison engine v1.
 Ten retailer connectors provide official search links and optional product-page
 structured data; they are NOT ten live pricing partnerships. Public priced
 observations originate only from connected providers with timestamps.
*/
const DIRECTORY=require('./stores.json');
const SUPPORTED=[
 ['walmart','https://www.walmart.com/search?q='],
 ['target','https://www.target.com/s?searchTerm='],
 ['costco','https://www.costco.com/CatalogSearch?keyword='],
 ['walgreens','https://www.walgreens.com/search/results.jsp?Ntt='],
 ['cvs','https://www.cvs.com/search?searchTerm='],
 ['kroger','https://www.kroger.com/search?query='],
 ['safeway','https://www.safeway.com/shop/search-results.html?q='],
 ['bestbuy','https://www.bestbuy.com/site/searchpage.jsp?st='],
 ['homedepot','https://www.homedepot.com/s/'],
 ['lowes','https://www.lowes.com/search?searchTerm=']
];
const RETAILERS=SUPPORTED.map(([id,search])=>{
 const store=DIRECTORY.find(s=>s.id===id);
 if(!store)throw Error('Unknown retailer '+id);
 return Object.freeze({...store,search});
});
const RETAILER_BY_ID=new Map(RETAILERS.map(s=>[s.id,s]));
const FRESH_WINDOW_DAYS=30;
const DATE_WINDOW_DAYS=180;
const DAY=86400000;
const robotsCache=new Map();
const pageCache=new Map();
function cleanName(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function matchMerchant(name){
 const m=cleanName(name).replace(/(store|online|com)$/,'');
 if(!m)return null;
 const alias={
  'walmart':'walmart','walmartmarketplace':'walmart','walmartexpress':'walmart',
  'cvspharmacy':'cvs','walgreenspharmacy':'walgreens',
  'thehomedepot':'homedepot','homedepot':'homedepot',
  'bestbuy':'bestbuy','bestbuycom':'bestbuy','safeway':'safeway',
  'kroger':'kroger','target':'target','costco':'costco','lowes':'lowes'
 };
 const match=alias[m]||m;
 return RETAILERS.find(x=>x.id===match||cleanName(x.name)===m)||null;
}
function isCode(code){return /^\d{8,14}$/.test(String(code||''))}
function sameGTIN(a,b){
 if(!isCode(a)||!isCode(b))return false;
 return String(a).replace(/^0+/,'')===String(b).replace(/^0+/,'');
}
function currencyPrice(value){
 if(value==null||String(value).trim()==='')return null;
 const x=Number(value);
 return Number.isFinite(x)&&x>0&&x<=100000?Math.round(x*100)/100:null;
}
function selectedList(input){
 if(!input||input==='all')return RETAILERS;
 const requested=[...new Set(String(input).split(',').slice(0,15))];
 return RETAILERS.filter(s=>requested.includes(s.id));
}
function searchURL(store,query){
 // This URL opens the official store search; it does not collect price data.
 return store.search+encodeURIComponent(String(query||'').slice(0,110));
}
function buildCompareResult(lookup,opts={}){
 const code=String(opts.code||lookup.code||''),q=String(opts.name||lookup.product?.title||code).trim().slice(0,110);
 if(!isCode(code))throw Error('INVALID_BARCODE');
 const selected=selectedList(opts.stores);
 const selectedIds=new Set(selected.map(s=>s.id));
 const baseline=currencyPrice(opts.baseline_price);
 const now=Date.now(),listed=Array.isArray(lookup.merchant_listings)?lookup.merchant_listings:[],
  historical=Array.isArray(lookup.historical_prices)?lookup.historical_prices:[];
 const matches=[],unknown=[];
 function record(entry){
  if(!entry||entry.currency!=='USD'||entry.price==null)return;
  const store=matchMerchant(entry.merchant||entry.store);
  if(!store){unknown.push(entry);return}
  if(!selectedIds.has(store.id))return;
  const price=currencyPrice(entry.price);if(price===null)return;
  const date=entry.last_updated||entry.date;
  const time=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(time)||time>Date.now()+DAY)return;
  const age=Math.floor((now-time)/DAY);
  if(age<0||age>DATE_WINDOW_DAYS)return;
  const observed=entry.kind==='crowdsourced_historical_observation'||entry.price_kind==='crowdsourced_historical_observation'||!!entry.date;
  const source=observed?'Open Prices':'UPCitemdb';
  const sameUnit=!!entry.price;
  matches.push({
   store_id:store.id,store_name:store.name,logo_domain:store.domain,
   unit_price:price,currency:'USD',source,price_kind:observed?'crowdsourced_observation':'merchant_listing',
   observed_date:date,age_days:age,
   freshness:age<=7?'recent':age<=30?'dated':'historical',
   verified_current:false,
   product_match:'exact_barcode',barcode:code,
   purchase_link:!observed&&typeof entry.url==='string'&&entry.url.startsWith('https://')?entry.url:null,
   city:observed?String(entry.city||'').slice(0,90):null,
   product_name:!observed?String(entry.title||q).slice(0,130):q,
   discount_type:'none_verified',possible_price_gap:baseline!==null&&baseline>price?Math.round((baseline-price)*100)/100:0,
   savings_earned:0,eligibility_notice:'Verify current store price, exact size, stock and retailer location. No discount is automatically redeemable.'
  });
 }
 listed.forEach(x=>record(x));historical.forEach(x=>record(x));
 matches.sort((a,b)=>a.unit_price-b.unit_price||a.age_days-b.age_days);
 // Do not compute a guaranteed best deal from old observations.
 const recent=matches.filter(x=>x.age_days<=FRESH_WINDOW_DAYS);
 const best=recent[0]||null;
 const stores=selected.map(store=>{
  const own=matches.filter(p=>p.store_id===store.id);
  return {id:store.id,name:store.name,logo_domain:store.domain,
   search_url:searchURL(store,q+' '+code),
   source_status:own.length?'reported':'no_observation',
   reported_count:own.length,lowest_reported_price:own.length?Math.min(...own.map(x=>x.unit_price)):null,
   offers:own.slice(0,5)};
 });
 return {
  code,product:lookup.product||null,queried_at:new Date(now).toISOString(),
  comparison_kind:'observed_not_live',selected_store_count:selected.length,connected_price_sources:['UPCitemdb','Open Prices'],
  source_status:{upcitemdb:lookup.lookup_status||'unknown',open_prices:lookup.price_status||'unknown'},
  store_connectors:stores,
  reported_prices:matches.slice(0,30),
  best_recent_reported:best?{store_id:best.store_id,store_name:best.store_name,
   price:best.unit_price,observed_date:best.observed_date,source:best.source,verified_current:false}:null,
  baseline_price:baseline,
  potential_difference:best&&baseline!==null&&baseline>best.unit_price?Math.round((baseline-best.unit_price)*100)/100:null,
  confirmed_savings:0,
  disclaimers:[
   'This is NOT a live checkout-price guarantee; public listing and crowd reports have limited coverage.',
   'Ten retailer search shortcuts do not equal ten authorized price-feed connections.',
   'Potential price differences are not confirmed coupon savings and never enter lifetime totals.',
   'Confirm exact barcode, pack size, availability, shipping and location before purchasing.'
  ]
 };
}
function parseProductURL(raw){
 if(typeof raw!=='string'||raw.length>1900)return null;
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
  const store=RETAILERS.find(r=>u.hostname===r.domain||u.hostname.endsWith('.'+r.domain));
  if(!store||u.pathname==='/'||u.pathname.length<3)return null;
  if(/\/(account|login|checkout|cart|auth|payment)(\/|$)/i.test(u.pathname))return null;
  return {store,url:u.origin+u.pathname,host:u.hostname,path:u.pathname};
 }catch{return null}
}
// robots.txt parser: conservatively honor user-agent-specific and wildcard rules.
// When robots is inaccessible, no HTML fetch is attempted.
function robotsAllowed(robots,path,agent='ScanSaveBeta'){
 const groups=[];let current=null;
 for(const raw of String(robots||'').split(/\r?\n/)){
  const line=raw.split('#')[0].trim();if(!line)continue;
  const i=line.indexOf(':');if(i<0)continue;
  const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
  if(key==='user-agent'){
   if(!current||current.rules.length)groups.push(current={agents:[],rules:[]});
   current.agents.push(value.toLowerCase());
  }else if((key==='allow'||key==='disallow')&&current){
   current.rules.push({allow:key==='allow',path:value});
  }
 }
 const name=agent.toLowerCase();let chosen=groups.filter(g=>g.agents.some(a=>name.includes(a)&&a!=='*'));
 if(!chosen.length)chosen=groups.filter(g=>g.agents.includes('*'));
 if(!chosen.length)return true;
 const rules=chosen.flatMap(g=>g.rules);
 let matched=null;
 for(const r of rules){
  if(!r.path)continue;
  const prefix=r.path.replace(/\*.*$/,'').replace(/\$$/,'');
  if(path.startsWith(prefix)&&(!matched||prefix.length>matched.length||(prefix.length===matched.length&&r.allow)))
   matched={length:prefix.length,allow:r.allow};
 }
 return matched?matched.allow:true;
}
async function boundedText(url,{timeout=5500,maxBytes=750000,contentType='text/html'}={}){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
 try{
  const r=await fetch(url,{headers:{'User-Agent':'ScanSaveBeta/0.4 (https://scansave-beta.onrender.com)','Accept':contentType==='text/html'?'text/html':'text/plain'},
   redirect:'error',signal:ac.signal});
  if(!r.ok)return {ok:false,status:r.status,text:null};
  if(!String(r.headers.get('content-type')||'').toLowerCase().includes(contentType))return {ok:false,status:415,text:null};
  const contentLength=Number(r.headers.get('content-length'))||0;
  if(contentLength>maxBytes)return {ok:false,status:413,text:null};
  const raw=await r.text();if(raw.length>maxBytes)return {ok:false,status:413,text:null};
  return {ok:true,status:r.status,text:raw};
 }catch(e){return {ok:false,status:503,text:null}}
 finally{clearTimeout(timer)}
}
async function permittedByRobots(parsed){
 const base='https://'+parsed.host+'/robots.txt';
 const cache=robotsCache.get(base);if(cache&&cache.exp>Date.now())return cache.allowed(parsed.path);
 const result=await boundedText(base,{contentType:'text/plain',maxBytes:200000,timeout:3500});
 let check;
 if(result.ok)check=p=>robotsAllowed(result.text,p);
 else if(result.status===404||result.status===410)check=()=>true;
 else check=()=>false;
 robotsCache.set(base,{allowed:check,exp:Date.now()+6*3600000});
 return check(parsed.path);
}
function crawlJSONLD(html,code,parsed){
 const scripts=[...String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 const nodes=[];
 const push=x=>{
  if(Array.isArray(x)){x.forEach(push);return}
  if(!x||typeof x!=='object')return;
  if(Array.isArray(x['@graph']))x['@graph'].forEach(push);
  nodes.push(x);
 };
 for(const m of scripts.slice(0,35)){
  try{push(JSON.parse(m[1].trim()))}catch{}
 }
 const exact=[];
 for(const p of nodes){
  const typ=p['@type'];
  if(![...Array.isArray(typ)?typ:[typ]].some(v=>String(v||'').toLowerCase().endsWith('product')))continue;
  const gtins=[p.gtin,p.gtin8,p.gtin12,p.gtin13,p.gtin14].filter(Boolean).map(String);
  if(!gtins.some(gtin=>sameGTIN(gtin,code)))continue;
  const offers=Array.isArray(p.offers)?p.offers:[p.offers].filter(Boolean);
  for(const o of offers){
   if(!o||typeof o!=='object'||!String(o['@type']||'Offer').includes('Offer'))continue;
   const currency=String(o.priceCurrency||o.priceSpecification?.priceCurrency||'').toUpperCase();
   if(currency!=='USD')continue;
   const price=currencyPrice(o.price||o.priceSpecification?.price);
   if(price===null)continue;
   const unavailable=/OutOfStock|SoldOut|Discontinued/i.test(String(o.availability||''));
   if(unavailable)continue;
   exact.push({store_id:parsed.store.id,store_name:parsed.store.name,logo_domain:parsed.store.domain,
    barcode:code,price,currency:'USD',source:'Retailer product page JSON-LD',
    product_name:String(p.name||'').slice(0,160),product_match:'exact_barcode',
    fetched_at:new Date().toISOString(),verified_current:false,
    price_kind:'page_advertised_unconfirmed',
    retailer_page:parsed.url,discount_confirmed:false,
    caveat:'Public product-page advertised price, not guaranteed location-specific checkout price. Shipping and eligibility not confirmed.'});
  }
 }
 return exact.sort((a,b)=>a.price-b.price);
}
async function lookupRetailerPage(code,rawURL){
 if(!isCode(code))return {status:'invalid_barcode',offers:[]};
 const parsed=parseProductURL(rawURL);
 if(!parsed)return {status:'unsupported_product_url',offers:[]};
 const key=code+'|'+parsed.url,hit=pageCache.get(key);
 if(hit&&hit.exp>Date.now())return hit.data;
 const permitted=await permittedByRobots(parsed);
 if(!permitted)return {status:'robots_disallow_or_unavailable',store:parsed.store.name,offers:[]};
 const result=await boundedText(parsed.url);
 if(!result.ok)return {status:'page_unavailable',http_status:result.status,store:parsed.store.name,offers:[]};
 const offers=crawlJSONLD(result.text,code,parsed);
 const out={status:offers.length?'reported':'no_matching_structured_data',store:parsed.store.name,
  offers,checked_at:new Date().toISOString()};
 pageCache.set(key,{data:out,exp:Date.now()+5*60000});
 if(pageCache.size>250)pageCache.delete(pageCache.keys().next().value);
 return out;
}
module.exports={RETAILERS,selectedList,matchMerchant,sameGTIN,buildCompareResult,parseProductURL,
 robotsAllowed,crawlJSONLD,lookupRetailerPage};
