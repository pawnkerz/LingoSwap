'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('./compare');
const now=new Date();
const isoDaysAgo=n=>new Date(now.getTime()-n*86400000).toISOString().slice(0,10);
const source={
 code:'049000050103',lookup_status:'ok',price_status:'ok',
 product:{title:'Coca-Cola 2 Liter',code:'049000050103'},
 merchant_listings:[
  {merchant:'Target',price:2.19,currency:'USD',last_updated:isoDaysAgo(3),title:'Coca-Cola 2 Liter',url:'https://www.upcitemdb.com/sample'},
  {merchant:'Wal-Mart.com',price:1.89,currency:'USD',last_updated:isoDaysAgo(6),title:'Coca-Cola 2 Liter',url:'https://www.upcitemdb.com/sample'},
  {merchant:'Walgreens',price:9,currency:'unspecified',last_updated:isoDaysAgo(1)},
  {merchant:'Target',price:0.4,currency:'USD',last_updated:isoDaysAgo(500)},
  {merchant:'Other Unknown Store',price:0.9,currency:'USD',last_updated:isoDaysAgo(1)}
 ],
 historical_prices:[
  {store:'Kroger Main',date:isoDaysAgo(10),price:2.05,currency:'USD',city:'Seattle',
   kind:'crowdsourced_historical_observation'}
 ]
};
test('ten authentic retailer search connectors and no unsupported arbitrary hosts',()=>{
 assert.equal(c.RETAILERS.length,10);
 assert.equal(new Set(c.RETAILERS.map(x=>x.id)).size,10);
 for(const s of c.RETAILERS)assert.ok(s.search.startsWith('https://'));
 assert.equal(c.selectedList('walmart,target,evil').length,2);
 assert.equal(c.selectedList('none').length,0);
});
test('match merchants without inventing retailer mappings',()=>{
 assert.equal(c.matchMerchant('Wal-Mart.com')?.id,'walmart');
 assert.equal(c.matchMerchant('CVS Pharmacy')?.id,'cvs');
 assert.equal(c.matchMerchant('Magic Seller'),null);
});
test('UPC match ignores GTIN leading zeros but rejects product substitution',()=>{
 assert.ok(c.sameGTIN('049000050103','00049000050103'));
 assert.equal(c.sameGTIN('049000050103','049000050104'),false);
 assert.equal(c.sameGTIN('abc','12345'),false);
});
test('dated USD listings are compared, unknown-currency listings cannot reduce USD estimate',()=>{
 const result=c.buildCompareResult(source,{code:source.code,stores:'all',baseline_price:'3.49'});
 assert.equal(result.selected_store_count,10);
 assert.equal(result.reported_prices.length,3);
 assert.equal(result.best_recent_reported.store_id,'walmart');
 assert.equal(result.best_recent_reported.price,1.89);
 assert.equal(result.potential_difference,1.60);
 assert.equal(result.confirmed_savings,0);
 assert.ok(result.reported_prices.every(p=>p.verified_current===false));
});
test('selected retailer filter limits results and shows unavailable store explicitly',()=>{
 const r=c.buildCompareResult(source,{code:source.code,stores:'target,bestbuy'});
 assert.equal(r.store_connectors.length,2);
 assert.equal(r.reported_prices.length,1);
 assert.equal(r.store_connectors.find(x=>x.id==='bestbuy').source_status,'no_observation');
 assert.ok(r.store_connectors.find(x=>x.id==='bestbuy').search_url.includes('bestbuy.com'));
});
test('SSRF and login page URLs are rejected',()=>{
 for(const url of ['http://target.com/p/id','https://target.com.evil.test/p/product','https://127.0.0.1/p/id',
 'https://target.com@127.0.0.1/p/id','https://www.target.com/account','https://www.target.com/']){
  assert.equal(c.parseProductURL(url),null,url);
 }
 assert.equal(c.parseProductURL('https://www.target.com/p/example-123?tracking=1').url,'https://www.target.com/p/example-123');
});
test('robots allow/disallow selection follows longest matching prefix',()=>{
 const rules='User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: ScanSaveBeta\nDisallow: /checkout\n';
 assert.equal(c.robotsAllowed(rules,'/checkout'),false);
 assert.equal(c.robotsAllowed(rules,'/product'),true);
 const wildcard='User-agent: *\nDisallow: /\nAllow: /product\n';
 assert.equal(c.robotsAllowed(wildcard,'/product/item'),true);
 assert.equal(c.robotsAllowed(wildcard,'/cart'),false);
});
test('only product structured data with exact UPC and USD price is accepted',()=>{
 const jsonld=JSON.stringify({'@context':'https://schema.org','@type':'Product',
  name:'Coca-Cola 2 Liter',gtin12:'049000050103',offers:{'@type':'Offer',price:'2.49',priceCurrency:'USD',availability:'https://schema.org/InStock'}});
 const parsed=c.parseProductURL('https://www.target.com/p/coca-cola');
 const good=c.crawlJSONLD('<script type="application/ld+json">'+jsonld+'</script>','049000050103',parsed);
 assert.equal(good.length,1);assert.equal(good[0].price,2.49);
 assert.equal(good[0].verified_current,false);
 assert.equal(c.crawlJSONLD('<script type="application/ld+json">'+jsonld+'</script>','049000050104',parsed).length,0);
 const badCurrency=jsonld.replace('"USD"','"EUR"');
 assert.equal(c.crawlJSONLD('<script type="application/ld+json">'+badCurrency+'</script>','049000050103',parsed).length,0);
});
test('product page does not accept out of stock structured offers',()=>{
 const jsonld=JSON.stringify({'@type':'Product',gtin12:'049000050103',offers:{price:3.45,priceCurrency:'USD',availability:'https://schema.org/OutOfStock'}});
 assert.equal(c.crawlJSONLD('<script type="application/ld+json">'+jsonld+'</script>','049000050103',c.parseProductURL('https://www.target.com/p/a')).length,0);
});
