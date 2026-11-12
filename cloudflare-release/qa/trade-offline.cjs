'use strict';
const net=require('node:net'),dns=require('node:dns');
const local=host=>['127.0.0.1','localhost','::1','[::1]'].includes(String(host).toLowerCase());
const fail=()=>{throw Error('OFFLINE_VALIDATION: external network blocked')};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...rest){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!local(u.hostname))fail();return originalFetch.call(this,input,...rest)};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let values=args;while(Array.isArray(values[0]))values=values[0];const first=values[0];let host=first&&typeof first==='object'?first.host:(typeof values[1]==='string'?values[1]:undefined);if(first&&typeof first==='object'&&first.path)fail();if(host!==undefined&&!local(host))fail();return connect.apply(this,args)};
const lookup=dns.lookup;dns.lookup=function(host,...args){if(!local(host))fail();return lookup.call(this,host,...args)};

// Browser requests are blocked unless a suite explicitly fulfills them or proxies to loopback.
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(name,...rest){const value=originalLoad.call(this,name,...rest);if(name==='playwright'&&!value.chromium.__offline){value.chromium.__offline=true;const launch=value.chromium.launch.bind(value.chromium);value.chromium.launch=async function(options){const browser=await launch(options);const protect=async page=>{await page.route('**/*',route=>{const u=new URL(route.request().url());return local(u.hostname)?route.continue():route.abort('blockedbyclient')});return page};const page=browser.newPage.bind(browser);browser.newPage=async (...a)=>protect(await page(...a));return browser;};}return value;};
