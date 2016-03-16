// Imports
importScripts('resource://gre/modules/osfile.jsm');
importScripts('resource://gre/modules/workers/require.js');

// Globals
var core = { // have to set up the main keys that you want when aCore is merged from mainthread in init
	addon: {
		path: {
			modules: 'chrome://jsc-pipes/content/modules/'
		}
	},
	os: {
		name: OS.Constants.Sys.Name.toLowerCase()
	}
};

var OSStuff = {}; // global vars populated by init, based on OS

// Imports that use stuff defined in chrome
// I don't import ostypes_*.jsm yet as I want to init core first, as they use core stuff like core.os.isWinXP etc
// imported scripts have access to global vars on MainWorker.js
importScripts(core.addon.path.modules + 'ostypes/cutils.jsm');
importScripts(core.addon.path.modules + 'ostypes/ctypes_math.jsm');

// Setup PromiseWorker
// SIPWorker - rev9 - https://gist.github.com/Noitidart/92e55a3f7761ed60f14c
var PromiseWorker = require('resource://gre/modules/workers/PromiseWorker.js');

// Instantiate AbstractWorker (see below).
var worker = new PromiseWorker.AbstractWorker()

// worker.dispatch = function(method, args = []) {
worker.dispatch = function(method, args = []) {// start - noit hook to allow PromiseWorker methods to return promises
  // Dispatch a call to method `method` with args `args`
  // start - noit hook to allow PromiseWorker methods to return promises
  // return self[method](...args);
  console.log('dispatch args:', args);
  var earlierResult = gEarlyDispatchResults[args[0]]; // i change args[0] to data.id
  delete gEarlyDispatchResults[args[0]];
  if (Array.isArray(earlierResult) && earlierResult[0] == 'noit::throw::') {
	  console.error('ok need to throw but i want to ensure .constructor.name is in promiseworker.js"s EXCEPTION_NAMES, it is:', earlierResult[1].constructor.name);
	  throw earlierResult[1];
  }
  return earlierResult;
  // end - noit hook to allow PromiseWorker methods to return promises
};
worker.postMessage = function(...args) {
  // Post a message to the main thread
  self.postMessage(...args);
};
worker.close = function() {
  // Close the worker
  self.close();
};
worker.log = function(...args) {
  // Log (or discard) messages (optional)
  dump('Worker: ' + args.join(' ') + '\n');
};

// Connect it to message port.
// self.addEventListener('message', msg => worker.handleMessage(msg)); // this is what you do if you want PromiseWorker without mainthread calling ability
// start - setup SIPWorker
var WORKER = this;
var gEarlyDispatchResults = {};
self.addEventListener('message', function(aMsgEvent) { // this is what you do if you want SIPWorker mainthread calling ability
	var aMsgEventData = aMsgEvent.data;
	if (Array.isArray(aMsgEventData)) {
		// console.log('worker got response for main thread calling SIPWorker functionality:', aMsgEventData)
		var funcName = aMsgEventData.shift();
		if (funcName in WORKER) {
			var rez_worker_call = WORKER[funcName].apply(null, aMsgEventData);
		}
		else { console.error('funcName', funcName, 'not in scope of WORKER') } // else is intentionally on same line with console. so on finde replace all console. lines on release it will take this out
	} else {
		// console.log('no this is just regular promise worker message');
		var earlyDispatchErr;
		var earlyDispatchRes;
		try {
			earlyDispatchRes = self[aMsgEvent.data.fun](...aMsgEvent.data.args);
			console.error('earlyDispatchRes:', earlyDispatchRes);
		} catch(earlyDispatchErr) {
			earlyDispatchRes = ['noit::throw::', earlyDispatchErr];
			console.error('error in earlyDispatchRes:', earlyDispatchErr);
			// throw new Error('blah');
		}
		aMsgEvent.data.args.splice(0, 0, aMsgEvent.data.id)
		if (earlyDispatchRes && earlyDispatchRes.constructor.name == 'Promise') { // as earlyDispatchRes may be undefined
			console.log('in earlyDispatchRes as promise block');
			earlyDispatchRes.then(
				function(aVal) {
					console.log('earlyDispatchRes resolved:', aVal);
					gEarlyDispatchResults[aMsgEvent.data.id] = aVal;
					worker.handleMessage(aMsgEvent);
				},
				function(aReason) {
					console.warn('earlyDispatchRes rejected:', aReason);
				}
			).catch(
				function(aCatch) {
					console.error('earlyDispatchRes caught:', aCatch);
					gEarlyDispatchResults[aMsgEvent.data.id] = ['noit::throw::', aCatch];
					console.error('aCatch:', aCatch);
				}
			);
		} else {
			console.log('not a promise so setting it to gEarlyDispatchResults, it is:', earlyDispatchRes);
			if (earlyDispatchRes) {
				console.log('not undefined or null so constructor is:', earlyDispatchRes.constructor.name);
			}
			gEarlyDispatchResults[aMsgEvent.data.id] = earlyDispatchRes;
			worker.handleMessage(aMsgEvent);
		}
	}
});

const SIP_CB_PREFIX = '_a_gen_cb_';
const SIP_TRANS_WORD = '_a_gen_trans_';
var sip_last_cb_id = -1;
self.postMessageWithCallback = function(aPostMessageArr, aCB, aPostMessageTransferList) {
	var aFuncExecScope = WORKER;
	
	sip_last_cb_id++;
	var thisCallbackId = SIP_CB_PREFIX + sip_last_cb_id;
	aFuncExecScope[thisCallbackId] = function(aResponseArgsArr) {
		delete aFuncExecScope[thisCallbackId];
		console.log('in worker callback trigger wrap, will apply aCB with these arguments:', aResponseArgsArr);
		aCB.apply(null, aResponseArgsArr);
	};
	aPostMessageArr.push(thisCallbackId);
	self.postMessage(aPostMessageArr, aPostMessageTransferList);
};
// end - setup SIPWorker

function init(objCore) { // function name init required for SIPWorker
	console.log('in worker init');
	
	// merge objCore into core
	// core and objCore is object with main keys, the sub props
	
	core = objCore;
	
	core.os.mname = core.os.toolkit.indexOf('gtk') == 0 ? 'gtk' : core.os.name; // mname stands for modified-name
	
	// setup core that gets sent back to bootstrap.js

	// os
	core.os.name = OS.Constants.Sys.Name.toLowerCase();
	
	// I import ostypes_*.jsm in init as they may use things like core.os.isWinXp etc
	console.log('bringing in ostypes');
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
			importScripts(core.addon.path.modules + 'ostypes/ostypes_win.jsm');
			break
		case 'gtk':
			importScripts(core.addon.path.modules + 'ostypes/ostypes_x11.jsm');
			break;
		case 'darwin':
			importScripts(core.addon.path.modules + 'ostypes/ostypes_mac.jsm');
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}
	console.log('brought in ostypes');
	
	// OS Specific Init
	switch (core.os.mname) {
		// case 'winnt':
		// case 'winmo':
		// case 'wince':
		// 		
		// 		OSStuff.msg = ostypes.TYPE.MSG();
		// 		
		// 	break;
		// case 'gtk':
		// 
		// 		OSStuff.xev = ostypes.TYPE.XEvent();
		// 
		// 	break;
		default:
			// do nothing special
	}
	
	console.log('HotkeyWorker init success');
	// return core; // for SIPWorker returnung is not required
}

// start - addon functionality
function prepTerm() {
	
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				// 
			
			break
		case 'gtk':
		
				// 
				
			break;
		case 'darwin':
		
				// 
				
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}
	
	console.error('ok HotkeyWorker prepped for term');
}

function openPipe(aPath) {
	
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				//
				console.log('open pipe at path:', aPath)
				return {
					status: true
				};
			
			break
		case 'gtk':
		
				// 
				
			break;
		case 'darwin':
		
				// 
				
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}

}


// end - addon functionality

// start - common helpers
// end - common helpers