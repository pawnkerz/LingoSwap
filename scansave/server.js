'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const PORT = Number(process.env.PORT || 10000);
const ORIGIN = 'https://scansave-beta.onrender.com';
const UA = 'ScanSaveBeta/0.3 (public barcode lookup; https://scansave-beta.onrender.com)';
const cache = new Map();
const requestLog = new Map();
const msDay = 86400000;
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
  const body=await cached('upc:'+code,4*3600000,()=>requestJSON('https://api.upcitemdb.com/prod/trial/lookup?upc='+encodeURIComponent(code),6500));
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
const SUPPORTED_HOSTS=['target.com','walmart.com','costco.com','walgreens.com','cvs.com','kroger.com','safeway.com'];
function parseRetailerURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
  if(!SUPPORTED_HOSTS.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null;
  return u.origin+u.pathname;
 }catch{return null}
}
async function couponOffers(productURL){
 const key=process.env.SOVRN_SECRET_KEY,apiKey=process.env.SOVRN_SITE_API_KEY;
 if(!key||!apiKey)return {status:'not_configured',sources_checked:0,offers:[],provider:'Sovrn product promo API (approval required)'};
 const url=parseRetailerURL(productURL);
 if(!url)return {status:'product_url_required',sources_checked:0,offers:[],provider:'Sovrn',message:'A canonical retailer product URL is required'};
 try{
  const params=new URLSearchParams({api_key:apiKey,product_url:url,include_unverified:'false'});
  const raw=await cached('sovrn:'+url,1200000,()=>requestJSON('https://viglink.io/coupons/product?'+params,7000,{'Authorization':'secret '+key}));
  const array=Array.isArray(raw)?raw:(Array.isArray(raw.codes)?raw.codes:Array.isArray(raw.coupons)?raw.coupons:[]);
  const offers=array.flatMap(o=>{
   if(!o||!(o.verified_at||o.verification_status==='verified'))return [];
   let link;try{link=new URL(o.affiliate_url||o.url)}catch{return []}if(link.protocol!=='https:')return [];
   return [{title:text(o.code_description||o.code||'Verified product promotion',140),description:text(o.code_description||'',300),url:link.href,code:text(o.code,70),verified:true,verified_at:o.verified_at||null,provider:'Sovrn'}];
  });
  if(raw.scan?.verification_active)return {status:'pending_verification',sources_checked:0,offers,provider:'Sovrn'};
  return {status:'ok',sources_checked:1,offers,provider:'Sovrn'};
 }catch(e){return {status:'unavailable',sources_checked:0,offers:[],provider:'Sovrn'};}
}
const server=http.createServer(async(req,res)=>{
 const host=new URL(req.url||'/', 'http://localhost');
 const origin=req.headers.origin||'';
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'});res.end();return}
 if(req.method!=='GET'){json(res,405,{error:'METHOD_NOT_ALLOWED'},origin);return}
 if(host.pathname==='/health'){json(res,200,{ok:true,app:'ScanSave API',coupon_provider_configured:!!(process.env.SOVRN_SECRET_KEY&&process.env.SOVRN_SITE_API_KEY),price_sources:['UPCitemdb','Open Prices']},origin);return}
 if(!['/api/lookup','/api/offers'].includes(host.pathname)){json(res,404,{error:'NOT_FOUND'},origin);return}
 const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'anonymous').split(',')[0].trim();
 const t=Date.now();let record=requestLog.get(ip)||{t,used:0};if(t-record.t>60000)record={t,used:0};record.used++;requestLog.set(ip,record);
 if(record.used>20){json(res,429,{error:'RATE_LIMITED'},origin);return}
 if(requestLog.size>10000)requestLog.clear();
 try{
  if(host.pathname==='/api/lookup'){const code=host.searchParams.get('code')||'';if(!codeOK(code)){json(res,400,{error:'INVALID_BARCODE'},origin);return}
   const data=await lookup(code);json(res,200,data,origin);return}
  const result=await couponOffers(host.searchParams.get('product_url')||'');json(res,200,result,origin);
 }catch(e){json(res,503,{error:'DATA_SOURCES_UNAVAILABLE'},origin)}
});
server.listen(PORT,'0.0.0.0',()=>console.log('ScanSave API listening on '+PORT));
