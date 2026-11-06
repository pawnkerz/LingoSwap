'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { normalizeSovrn,parseRetailerURL,couponOffers,STORE_DIRECTORY,normalizePublicDeals }=require('./server');
const now=Date.now();
const recent=new Date(now-2*86400000).toISOString();
const old=new Date(now-50*86400000).toISOString();
function response(coupons=[],active=false){
 return {merchant:{domain:'target.com',group_name:'Target'},scan:{verification_active:active,when_to_check_back:3600},coupons};
}
function code(extra={}){
 return {id:'fixture-promo',code:'TEST20',affiliated_url:'https://redirect.viglink.com/outbound',verified:true,
 currency:'USD',original_price:52,price_with_code:41.60,verified_at:recent,code_description:'20% off one online product',...extra};
}
test('supports 106 distinct retailer directory entries',()=>{
 assert.equal(STORE_DIRECTORY.length,106);
 assert.equal(new Set(STORE_DIRECTORY.map(s=>s.domain)).size,106);
});
test('validates canonical product URLs and blocks unsafe hosts',()=>{
 assert.equal(parseRetailerURL('https://www.target.com/p/product-123?utm_source=test'), 'https://www.target.com/p/product-123');
 assert.equal(parseRetailerURL('https://www.homedepot.com/p/sample123'),'https://www.homedepot.com/p/sample123');
 for(const bad of ['http://target.com/p/item','https://target.com.evil.example/p/item','https://target.com@evil.example/p/item','https://www.target.com/','https://127.0.0.1/p/item','https://target.com/p/x#fragment']){
  assert.equal(parseRetailerURL(bad),null,bad);
 }
});
test('returns verified online coupon with provider-proven amount',()=>{
 const r=normalizeSovrn(response([code()]));
 assert.equal(r.status,'ok');assert.equal(r.sources_checked,1);
 assert.equal(r.offers.length,1);
 const offer=r.offers[0];
 assert.equal(offer.code,'TEST20');assert.equal(offer.original_price,52);assert.equal(offer.price_with_code,41.6);
 assert.equal(offer.potential_online_savings,10.4);
 assert.equal(offer.verified,true);assert.equal(offer.channel,'online_promo_code');
 assert.equal(offer.auto_redeemable,false);assert.equal(offer.requires_checkout_confirmation,true);
});
test('unverified code cannot be promoted to verified coupons',()=>{
 const r=normalizeSovrn(response([code({verified:false})]));
 assert.equal(r.status,'no_verified_offers');assert.equal(r.sources_checked,1);assert.equal(r.offers.length,0);
});
test('unverified results and invalid affiliate URL never leak into verified offers',()=>{
 const r=normalizeSovrn(response([code({id:'bad-host',affiliated_url:'javascript:alert(1)'}),code({id:'bad-code',code:''})]));
 assert.equal(r.offers.length,0);assert.equal(r.status,'no_verified_offers');
});
test('pending provider scan does not assert that no coupons exist',()=>{
 const r=normalizeSovrn(response([],true));
 assert.equal(r.status,'pending_verification');assert.equal(r.sources_checked,0);
 assert.equal(r.when_to_check_back,3600);
});
test('stale verified-at timestamps are surfaced only as stale candidates',()=>{
 const r=normalizeSovrn(response([code({verified_at:old})]));
 assert.equal(r.offers.length,0);assert.equal(r.stale_candidates.length,1);
 assert.equal(r.status,'no_verified_offers');assert.equal(r.stale_candidates[0].verified,false);
});
test('invalid schema cannot be mistaken for a successful empty search',()=>{
 const r=normalizeSovrn({codes:[code()],scan:{verification_active:false}});
 assert.equal(r.sources_checked,0);assert.equal(r.status,'unavailable');
});
test('unknown currency never creates a USD saving amount',()=>{
 const r=normalizeSovrn(response([code({currency:'EUR'})]));
 assert.equal(r.offers[0].potential_online_savings,null);
 assert.equal(r.offers[0].original_price,null);
});
test('not configured means no sources checked',async()=>{
 const key=process.env.SOVRN_SECRET_KEY,api=process.env.SOVRN_SITE_API_KEY;
 delete process.env.SOVRN_SECRET_KEY;delete process.env.SOVRN_SITE_API_KEY;
 try{const r=await couponOffers('https://www.target.com/p/item');assert.equal(r.status,'not_configured');assert.equal(r.sources_checked,0)}
 finally{if(key===undefined)delete process.env.SOVRN_SECRET_KEY;else process.env.SOVRN_SECRET_KEY=key;
 if(api===undefined)delete process.env.SOVRN_SITE_API_KEY;else process.env.SOVRN_SITE_API_KEY=api}
});

test('public merchant deals remain clearly unverified for specific products',()=>{
 const fixture={results:[
  {id:1,title:'Nutella 20% off at Target',merchant:{name:'Target'},code:'NUTELLA20',url:'/deals/1',valid_until:new Date(Date.now()+7*86400000).toISOString()},
  {id:2,title:'Vacuum cleaner promotion',merchant:{name:'Walmart'},url:'/deals/2'}
 ]};
 const r=normalizePublicDeals(fixture,'Nutella',[]);
 assert.equal(r.status,'ok');assert.equal(r.offers.length,1);
 assert.equal(r.offers[0].verified_for_product,false);
 assert.equal(r.offers[0].auto_redeemable,false);
 assert.equal(r.offers[0].url,'https://partners.clickwise.net/deals/1');
});
test('expired merchant promotion is excluded',()=>{
 const fixture={results:[{id:3,title:'Nutella promo',merchant:{name:'Target'},code:'EXPIRED',
  url:'/deals/3',valid_until:new Date(Date.now()-86400000).toISOString()}]};
 const r=normalizePublicDeals(fixture,'Nutella',[]);
 assert.equal(r.offers.length,0);
});
test('selecting a retailer finds that store only, never a product verification claim',()=>{
 const fixture={results:[
  {id:1,title:'Sitewide Target promotions',merchant:{name:'Target'},url:'/deals/1'},
  {id:2,title:'Sitewide Walmart promotions',merchant:{name:'Walmart'},url:'/deals/2'}
 ]};
 const target=STORE_DIRECTORY.find(s=>s.id==='target');
 const r=normalizePublicDeals(fixture,'Nutella',[target]);
 assert.equal(r.offers.length,1);
 assert.equal(r.offers[0].store,'Target');
 assert.equal(r.offers[0].verified_for_product,false);
});
