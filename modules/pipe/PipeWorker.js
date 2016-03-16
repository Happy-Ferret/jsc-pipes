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

var gPipe = {};

function openPipe(aPath, aBoolPreExisting) {
	// aBoolPreExisting
		// true
			// means the pipe at aPath should be assumed it exists, and it should open. if it fails to open due to not existing then report that error
		// false
			// pipe is created and opened only if it doesnt exist. if it exists then it fails to create and open.
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				if(gPipe[aPath]) {
					return {
						status: false,
						msg: 'Pipe already open!'
					};
				}
				
				var pipeMode = ctypes_math.UInt64.or(ostypes.CONST.GENERIC_READ, ostypes.CONST.GENERIC_WRITE);
				var dwCreationDisposition = aBoolPreExisting ? OS.Constants.Win.OPEN_EXISTING : OS.Constants.Win.CREATE_NEW;
				console.log('dwCreationDisposition:', dwCreationDisposition);
				
				var hFile = ostypes.API('CreateFile')(aPath, pipeMode, ostypes.CONST.FILE_SHARE_READ | ostypes.CONST.FILE_SHARE_WRITE, null, dwCreationDisposition, ostypes.CONST.FILE_ATTRIBUTE_NORMAL, null);
				var hFileInt = ctypes.cast(hFile, ctypes.int).value.toString();
				
				console.log('hFile:', hFile);
				console.log('hFile deep:', cutils.jscGetDeepest(hFile));
				console.log('hFile deep 10:', cutils.jscGetDeepest(hFile, 10));
				console.log('hFile deep 16:', cutils.jscGetDeepest(hFile, 16));
				console.log('hFileInt:', hFileInt);
				
				if (cutils.jscEqual(hFileInt, -1)) {
					var msg;
					if (aBoolPreExisting && ctypes.winLastError == OS.Constants.Win.ERROR_FILE_NOT_FOUND) {
						// aBoolPreExisting means the user expected it to exist, but it doesnt
						msg = 'Pipe does not exist! So it could not be opened! You should click on "Create & Open".';
					} else if (!aBoolPreExisting && ctypes.winLastError == OS.Constants.Win.ERROR_ALREADY_EXISTS) {
						// !aBoolPreExisting, means user expected it to NOT exist, so they wanted to create it but it already exists, so creation (as well as open) failed
						msg = 'Pipe already exists! So it could not be created! You shoudl click on "Open Existing".';
					}
					return {
						status: false,
						msg: msg ? msg : 'Failed to open pipe, got error: ' + ctypes.winLastError
					};
				}
				
				gPipe[aPath] = hFile;
				
				return {
					status: true,
					msg: 'Pipe opened'
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

function closePipe(aPath, aBoolDelete) {
	// aBoolDelete if true - then it is attempted to delete pipe. if you didnt create the pipe, or dont have delete access it will return the error
	
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				var hFile = gPipe[aPath];
				if (!hFile) {
					return {
						status: false,
						msg: 'Pipe at this path was never opened'
					};
				}
				
				var rez_close = ostypes.API('CloseHandle')(hFile);
				console.log('rez_close:', rez_close);
				if (!rez_close) {
					return {
						status: false,
						msg: 'Failed to close pipe got error: ' + ctypes.winLastError
					};
				} else {
					delete gPipe[aPath];
					return {
						status: true,
						msg: 'Closed pipe'
					};
				}
			
			break
		case 'gtk':
		
				return {
					status: false,
					msg: 'Unix/Linux platforms not yet supported'
				};
				
			break;
		case 'darwin':
		
				return {
					status: false,
					msg: 'Mac platforms not yet supported'
				};
				
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}

}

function writePipe(aPath, aContentsToWrite, aBoolUnicodeContents) {
	
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				var hFile = gPipe[aPath];
				if (!hFile) {
					return {
						status: false,
						msg: 'Pipe at this path was never opened'
					};
				}
				
				var buffToWrite;
				if (aBoolUnicodeContents) {
					buffToWrite = ostypes.TYPE.WCHAR.array()(aContentsToWrite);
				} else {
					buffToWrite = ostypes.TYPE.CHAR.array()(aContentsToWrite);
				}
				
				var bytesWritten = ostypes.TYPE.DWORD();
				var rez_write = ostypes.API('WriteFile')(hFile, buffToWrite, buffToWrite.constructor.size, bytesWritten.address(), null);
				console.log('rez_write:', rez_write);
				console.log('bytesWritten:', cutils.jscGetDeepest(bytesWritten, 10));
				
				if (!rez_write) {
					return {
						status: false,
						msg: 'Failed to write to pipe got error: ' + ctypes.winLastError
					};
				} else {
					return {
						status: true,
						msg: 'Succesfully wrote ' + cutils.jscGetDeepest(bytesWritten, 10) + ' to pipe'
					};
				}
			
			break;
		case 'gtk':
		
				return {
					status: false,
					msg: 'Unix/Linux platforms not yet supported'
				};
				
			break;
		case 'darwin':
		
				return {
					status: false,
					msg: 'Mac platforms not yet supported'
				};
				
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}
}

function readPipe(aPath, aBoolUnicodeContents) {
	switch (core.os.mname) {
		case 'winnt':
		case 'winmo':
		case 'wince':
		
				var hFile = gPipe[aPath];
				if (!hFile) {
					return {
						status: false,
						msg: 'Pipe at this path was never opened'
					};
				}
				
				var bufSize = 1024;
				var bufRead;
				if (aBoolUnicodeContents) {
					bufSize *= 2; // because i allow for at least 1024 characters to be read, thats what i meant by setting bufSize to 1024
					bufRead = ostypes.TYPE.WCHAR.array(bufSize)();
				} else {
					bufRead = ostypes.TYPE.CHAR.array(bufSize)();
				}
				
				var bytesRead = ostypes.TYPE.DWORD();
				var rez_read = ostypes.API('ReadFile')(hFile, bufRead, bufSize, bytesRead.address(), null);
				console.log('rez_read:', rez_read);
				console.log('bytesRead:', cutils.jscGetDeepest(bytesRead, 10));
				console.log('bufRead:', bufRead.readString());
				
				if (!rez_read) {
					return {
						status: false,
						msg: 'Failed to read from pipe, got error: ' + ctypes.winLastError
					};
				} else {
					return {
						status: true,
						msg: 'Contents: "' + bufRead.readString() + '"'
					};
				}
			
			break
		case 'gtk':
		
				return {
					status: false,
					msg: 'Unix/Linux platforms not yet supported'
				};
				
			break;
		case 'darwin':
		
				return {
					status: false,
					msg: 'Mac platforms not yet supported'
				};
				
			break;
		default:
			throw new Error('Operating system, "' + OS.Constants.Sys.Name + '" is not supported');
	}
}
// end - addon functionality

// start - common helpers
// end - common helpers