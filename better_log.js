//simpleSourceMap=/my_modules/better_log.js
//simpleSourceMap2=/lib/better_log.js
/*
* @module BetterLog
* @author plundell 
* @email qmusicplayer@protonmail.com
* @license MIT
* @exports A contructor function for {BetterLog} instances.
*
* This module exports a constructor for a logger. It can be required by NodeJS or loaded directly
* in a browser with <script src="/path/to/better_log.js>"
*
* @param object globalObj 		Either window if in broswer (see bottom), or 'this', ie whatever scope
* 								this script is executed in
*
* TODO 2019-06-13: Add source map support. Look at:
*		https://github.com/xpl/stacktracey
*		https://github.com/xpl/get-source
* 		https://github.com/mozilla/source-map
*
* TODO 2020-02-07: Use more of devtools console functionality
*		https://github.com/jaredwilli/devtools-cheatsheet
*/
;'use strict';
(function(globalObj){
	const firstLineMarker=new Error('First line marker');
	//This will get set by the first instance to be created 
	var startTime;

	//Since this file can add a bunch of lines to the stack, change it from default of 10 to 20
	try{
		if(Error.stackTraceLimit==10)
			Error.stackTraceLimit=20
	}catch(err){console.error(err)}

    BetterLog._envDetails={};

	//Export from module if available
    if(typeof module === 'object' && module.exports){
        module.exports = BetterLog;

	    //It may still not be running in terminal, some packer may be using module, but if there's a process...
		if(typeof process=='object' && process && process.env){
    		BetterLog._env=process.execArgv.join(' ').includes('inspect')?'inspector' : 'terminal'; 
	    	BetterLog._development=(process.env.NODE_ENV=='development');
		}
    }


    //Set on window if available
    if(typeof window === 'object'){
    	window.BetterLog=BetterLog;

        BetterLog._development=(typeof ENV=='string' ? ENV : window.ENV)=='development';
    	
    	if(!BetterLog._env)
        	BetterLog._env='browser'; 
        else if(BetterLog._env=='terminal')
			BetterLog._env='inspector'; 
        

        //Simple browser detection, from https://stackoverflow.com/a/9851769
		if(typeof InstallTrigger !== 'undefined')
			BetterLog._envDetails.browser='firefox';
		else if(/constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && safari.pushNotification)))
			BetterLog._envDetails.browser='safari';
		else if(/*@cc_on!@*/false || !!document.documentMode)
			BetterLog._envDetails.browser='ie';
		else if(!!window.StyleMedia)
			BetterLog._envDetails.browser='edge';
		else{
			BetterLog._envDetails.chrome = (!!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime));
			if(BetterLog._envDetails.chrome && (navigator.userAgent.indexOf("Edg") != -1))
				BetterLog._envDetails.browser='edge_chromium'; //new microsoft edge since 2020
			else{
				if((!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0){
					BetterLog._envDetails.opera=true
					BetterLog._envDetails.browser='opera';
				}else if(BetterLog._envDetails.chrome){
					BetterLog._envDetails.browser='chrome'; 

					//If it has any chromium plugins, assume it's chromium
					for(let plugin of navigator.plugins){
						if(plugin.name.startsWith('Chromium')){
							BetterLog._envDetails.browser='chromium';
							break;
						}
					}
				}
				BetterLog._envDetails.blink = ((BetterLog._envDetails.opera||BetterLog._envDetails.chrome)&&!!window.CSS);
			}
		}

		//https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent
		BetterLog._envDetails.touch=false;
		if("maxTouchPoints" in navigator){ 
		    BetterLog._envDetails.touch=navigator.maxTouchPoints > 0;
		}else if("msMaxTouchPoints" in navigator){
		    BetterLog._envDetails.touch=navigator.msMaxTouchPoints > 0; 
		}else{
		    let mQ = window.matchMedia && matchMedia("(pointer:coarse)");
		    if(mQ && mQ.media === "(pointer:coarse)"){
		        BetterLog._envDetails.touch=!!mQ.matches;
		    }else if ('orientation' in window){
		        BetterLog._envDetails.touch=true; // deprecated, but good fallback
		    }else{
		        // Only as a last resort, fall back to user agent sniffing
		        let UA = navigator.userAgent;
		        BetterLog._envDetails.touch=(
		            /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) ||
		            /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA)
		        );
		    }
		}
    }

    /*
	* From an error, extract the 'where' and create an object that points to a specific file,line,pos. 
	* This can later (together with a second marker) to determine if an error comes from between 
	* those two markers
	*
	* @param err <Error>
	* @throws Error
	* @return object 	{file,line,pos}
    */
    function prepareInFileMarker(err){
    	if(err instanceof Error){
	    	return parseStackLine(err.stack.split('\n').slice(1,2).shift());
    	}else if(typeof err=='object' && err && err.file && typeof err.line=='number' && typeof err.pos=='number')
    		return err
    	else
    		throw new Error("Expected an <Error> or an already prepared marker, got: "+logVar(err));
    }



    /*
    * Extend version of native Map class which supports "aliases". This gives the ability to use multiple
    * "keys" for the same value, without affecting size or iteration
    */
	function BetterMap(data){
	    var map=new Map(data);
	    var __has=map.has.bind(map);
	    var __get=map.get.bind(map);
	    var __set=map.set.bind(map);
	    var __delete=map.delete.bind(map);
	    var aliases=new Map();
	    function resolveAlias(key){return __has(key)||!aliases.has(key) ? key : aliases.get(key);}
	    var restricted=['set','get','has','delete'];
	    Object.defineProperties(map,{
	        aliases:{value:aliases}
	        ,resolve:{value:resolveAlias}
	        ,has:{value:function _has(key){return __has(resolveAlias(key))}}
	        ,get:{value:function _get(key){return __get(resolveAlias(key))}}
	        ,set:{value:function _set(key,value){
	        	key=resolveAlias(key);
	        	if(typeof key=='string'&&!map.hasOwnProperty(key))
	        		Object.defineProperty(map,key,{configurable:true,get:()=>__get(key),set:(val)=>_set(key,val)})
	        	return __set(key,value)}
	        }     
	        ,delete:{value:function _delete(key){
				key=resolveAlias(key);
	        	if(typeof key=='string'&&!restricted.includes(key))
	        		delete map[key];
	        	return __delete(key)}
	        }
	    })
	    return map;
	}

	const SimpleSourceMap={}
	Object.defineProperties(SimpleSourceMap,{

		//Stores previous lookups to speed up lines that get looked up constantly
		cache:{value:{},writable:true}

		/*
		* Add data to the local sourcemap. Data should be generated with:
		*	grep //XXXsimpleSourceMap= <path to file> -n | sed -r 's#//XXXsimpleSourceMap=##' | tr '\n' ';' >> $TARGET"/$1.js"
		* (remove XXX from above command, that's just there so grep doesn't match this line)
		* which produces the format
		*	2:"better_events.js"
		*	1019:""
		*	1022:"better_log.js"
		*	3012:""
		* which should be passed to this method
		*
		* @param string file 	The name of combine/ugly file
		* @param string data 	The string generated by the above command
		*/
		,add:{value:function addSourceMap(file,data){
			if(typeof file!='string' || typeof data!='string')
				throw new TypeError("Expected 2 strings, the full path and the sourcemap string, got: "
					+logVar(file)+' , '+logVar(data));


			SimpleSourceMap[file]=data.split(';')
				.map(line=>{let arr=line.split('=');arr[0]=Number(arr[0])-1;return arr;})
				.filter(arr=>arr.length==2 && typeof arr[0]=='number' && typeof arr[1]=='string');

			BetterLog._syslog.info("Added simpleSourceMap for "+file,SimpleSourceMap[file]);
			
			//Clear cache since we may have added previously cached missing stuff
			SimpleSourceMap.cache={};


			return;
		}}
		/*
		* Use the source map to translate a fileline given by an error stack to the fileline of the original file
		*
		* @param string line 	A line like http://localhost/lib.js:1222:34
		*
		* @return string||undefined  	
		*/
		,lookup:{value:function lookupSource(str,prependOrigin=false){
			// debugger;
			//First check if we've already found the source of this line...
			if(SimpleSourceMap.cache.hasOwnProperty(str))
				return SimpleSourceMap.cache[str];

			var arr=str.split(':')
				,pos=arr.pop()
				,line=arr.pop()
				,file=arr.join(':')
			;

			if(SimpleSourceMap.hasOwnProperty(file)){
				let list=SimpleSourceMap[file];
				for(let i=list.length-1;i>=0;i--){
					if(line>list[i][0]){

						//Empty values (which are used to mark the end of a file) implies that this
						//line is outside any map and we jump to bottom and handle as such
						if(!list[i][1])
							break;

						var source=`${list[i][1]}:${line-list[i][0]}:${pos}`;
						if(prependOrigin)
							source=document.location.origin+source;
						SimpleSourceMap.cache[str]=source
						return source;
					}   					
				}
			}

			//If we didn't find anything we don't want to search again next time, so store the string with
			//an empty str
			SimpleSourceMap.cache[str]=undefined
			return undefined;
		}}

		,length:{get:function length(){
			return Object.keys(SimpleSourceMap).length
		}}
	})



	function isBetterLog(x){
		if(typeof x=='object' && x && x._isBetterLog){
			// if(!(x instanceof BetterLog)){
			// 	BetterLog._syslog.warn("BetterLog has been exported at least twice:",BetterLog._syslog, x.constructor._syslog)
			// }
			return true;
		}else{
			return false;
		} 
	}



	Object.defineProperty(BetterLog,'_development',{writable:false,configurable:false});

	const logLvl=[
		{str:'trace',nr:1,colorTerm:'cyan',colorBrow:'background:cyan;color:black',print:console.debug}
		,{str:'debug',aliases:['verbose'],nr:2,colorTerm:'light blue',colorBrow:'background:#5862f3;color:white',print:console.log}
		,{str:'info',nr:3,colorTerm:'light green',colorBrow:'background:#3bd473;color:black',print:console.log}
		,{str:'note',aliases:['notice'],nr:4,colorTerm:'light yellow',colorBrow:'background:#f23dfb;color:white',print:console.warn}
		,{str:'warn',aliases:['warning'],nr:5,colorTerm:'light red',colorBrow:'background:orange;color:black',print:console.warn}
		,{str:'error',nr:6,colorTerm:'light red background',colorBrow:null,print:console.error}
	]

	//Add capitalized versions
	logLvl.forEach(obj=>{obj.STR=obj.str.toUpperCase();obj.Str=obj.str[0].toUpperCase()+obj.str.slice(1)});

	//For faster lookup, create a lookup table who's keys are both number and string id's of levels
	const lvlLookup={};
	logLvl.forEach(obj=>{
		lvlLookup[obj.str]=obj;
		lvlLookup[obj.STR]=obj;
		lvlLookup[obj.nr]=obj;
		if(obj.aliases){
			obj.aliases.forEach(alias=>lvlLookup[alias]=obj)
		}
	})






		/*
			Terminal color cheat sheet

			Color			Text    Background
			Black           30      40
			Red             31      41
			Green           32      42
			Yellow          33      43
			Blue            34      44
			Magenta         35      45
			Cyan            36      46
			White           37      47	
			Light Black    90      100
			Light Red      91      101
			Light Green    92      102
			Light Yellow   93      103
			Light Blue     94      104
			Light Magenta  95      105
			Light Cyan     96      106
			Light White    97      107
		*/
	const highlightColor={
		'red':{colorTerm:'red background;default',colorBrow:'background:red'}
		,'blue':{colorTerm:'blue background;default',colorBrow:'background:blue'}
		,'magenta':{colorTerm:'magenta background;default',colorBrow:'background:magenta'}
		,'pink':{colorTerm:'pink background;default',colorBrow:'background:pink'}
		,'green':{colorTerm:'green background;default',colorBrow:'background:green'}
		,'yellow':{colorTerm:'yellow background;default',colorBrow:'background:yellow'}
		,'cyan':{colorTerm:'cyan background;default',colorBrow:'background:cyan'}
	}


	const bashColors={
		'default':39
		,'default background':49
		,'black':30
		,'black background':40
		,'red':31
		,'red background':41
		,'green':32
		,'green background':42
		,'yellow':33
		,'yellow background':43
		,'blue':34
		,'blue background':44
		,'magenta':35
		,'magenta background':45
		,'cyan':36
		,'cyan background':46
		,'light gray':37
		,'light gray background':47	
		,'gray':90
		,'gray background':100
		,'light red':91
		,'light red background':101
		,'light green':92
		,'light green background':102
		,'light yellow':93
		,'light yellow background':103
		,'light blue':94
		,'light blue background':104
		,'light magenta':95
		,'light magenta background':105
		,'pink':95 //alias for light magenta
		,'pink background':105
		,'light cyan':96
		,'light cyan background':106
		,'white':97
		,'white background':107
		,'reset':0 //resets text but not background
		,'reset background':49 //alias for 'default background'
		,'reset bold':21
		,'reset dim':22
		,'reset underlined':24
		,'reset blink':25
		,'reset invert':27
		,'reset hidden':28
		,'bold':1
		,'dim':2	
		,'underlined':4	
		,'blink':5 //doesn't work on most terminals
		,'invert':7 //invert the foreground and background colors
		,'hidden':8 //useful for passwords
	}
	for(let c of Object.values(bashColors)){
		bashColors[c]=c;
	}


	/*
	* Get the bash color code string which is ready to be inserted into any other string and will cause anything after
	* it to be written in that color
	*
	* @param string|number color   One or more colors, either ';' separated or in array, eg. 'reset background; pink'
	*
	* @return string                     eg. '\x1b[49m\x1b[95m'
	*/
	function getBashColorCode(color){
		//Turn into array since there may be more than 1 color
		if(typeof color == 'string' && color.includes(';')){
			return color.split(';').map(str=>getBashColorCode(str.trim())).join('');
		}else if(bashColors.hasOwnProperty(color)){
			return '\x1b['+bashColors[color]+'m'; //the looked up value is a number
		}
	}



	function getLvlNr(x=3,d=3){
		return (lvlLookup.hasOwnProperty(x) ? lvlLookup[x].nr : d);
	}




	Object.defineProperty(BetterLog,'defaultOptions',{enumerable:true
		,get:function getDefaultOptions(){return JSON.parse(JSON.stringify(defaultOptions))}
		
		/*
		* Change default options (also changes set options for all logs already setup)
		*
		* @param object options
		*
		* @return void
		*/
		,set:function setDefaultOptions(options){
			if(typeof options !='object'){
				throw new TypeError('Expected object, got: ('+typeof options+')'+String(options));
			}
			
			//env is not a regular options because it needs to be the same even for instances loaded before this method
			//is called... so an ugly hack/backwards compatible is to do this...
			if(options.hasOwnProperty('env')){
				BetterLog._env=options.env;
				delete options.env;
			}

			//Change the class-wide private variable which will affect future logs being created...
			Object.assign(defaultOptions,options);

			//...but also change all logs already created
			BetterLog._instances.forEach(log=>Object.assign(log.options,options));

			return;
		}

	})






	const defaultOptions={
		autoPrintLvl:5 //Lowest level to get printed automatically when entry in created, default everything, 0==off
		,lowestLvl:1 //Lowest level to even process, used only by the shortcuts this.debug|info etc...
		,appendSyslog:true
		,appendLog:null //another instance of BetterLog to append entries from this log. The name of that instance will be prepended ours
		,printStackLvl:0 //0==off, the lowest level at which to print stack
		,printStackLines:0 //0==all, or rather see Error.stackTraceLimit. number of lines of stack to print at most
		,hideParentStack:false //true==when printing bubbled stacks, remove lines also present it parent stack
		,printColor:true
		,printWhere:true //appends each line with file:line:index of log
		,printFunc:true
		,printId:false
		,printTime:false
		,printMs:true //will override printTime
		,printSelfOnLvl:0 //0==off. only available in browser, prints BLE object as last extra if lvl >=
		,name:null //Overrides this.toString(). Gets printed with each message. May be appeneded with interger if not unique
		,sourcePrefix:false //Printed before name. Default nothing. Suitable for default options or one-time use, else just use 'name'
		,printMarks:true //Before the source, each mark is printed like [mark]
		,breakOnError:false
		,msgLength:1000     //The longest printed msg string of an entry    NOTE: this doesn't apply to objects in in browser
		,extraLength:1000   //The longest printed extra string of an entry   ^^

		,hideInternalStack:true //true==remove stack entries that refers to internal stuff. Only works as static option
		,rootPath:(typeof process=='object'&&process&&process.cwd?process.cwd():false) //root path that will be replaced by '.' from ALL paths (stack + end of line)
		,fileOnly:true //overrides rootPath, only prints the file, not entire path
	}


	{
		/*
		* Temporarily make all logs emit everything
		*
		* @param string action      'on' or 'off'
		*
		* @return boolean 			True if the action was taken (so caller knows if they should toggle it again later)
		*/
		let lowestLvls;
		function debugMode(action){
			if(action=='on'){
				if(lowestLvls){
					return false;
				}else{
					lowestLvls=new Map();
					BetterLog._instances.forEach(log=>{
						if(log.options.lowestLvl>1){
							lowestLvls.set(log,log.options.lowestLvl);
							log.options.lowestLvl=1;
						}
					});
					return true;
				}
			}else if(action=='off'){
				if(!lowestLvls){
					return false;
				}else{
					BetterLog._instances.forEach(log=>{
						if(lowestLvls.has(log)){
							log.options.lowestLvl=lowestLvls.get(log);
						}
					});
					lowestLvls=null;
					return true;
				}
			}else{
				throw new Error("Expected only arg to be 'on' or 'off'");
			}
		}
	}






	/*
	* Make sure we have a string and prepend it by a known (arbitrary) string also used in getStackArray()
	*
	* Factoid: props containing only numbers don't show up in the stack the way we need them for this to work, so we 
	*		   append '_mark_' (but getStackArray() won't include it in it's capture group so entry.stackArr.mark == $mark)
	*
	* @param string mark
	*
	* @return string
	*/
	function makeMark(mark){
		mark=String(mark);
		if(!mark.startsWith('_mark_'))
			mark='_mark_'+mark;
		return mark;
	}

	function unmakeMark(mark){
		mark=String(mark);
		if(mark.startsWith('_mark_'))
			return mark.substring(6);
		else
			return mark;
	}

	/*
	* Get a possible mark from a string
	* @param string str 	     Can be a stack line, a stackArr[i].func or a Error().stack (in which case the latest applied mark is returned)
	* @return string|undefined   The mark if present, or undefined
	*/
	function getMark(str){
		if(typeof str=='string'){
			var m=str.match(/\[as _mark_([^\]]+)\]/)
			if(m)
				return m[1];
		}
	}


	/*
	* Wrap a function so when it's called a "mark" is inserted in the callstack which is identified by getStackArray()>parseStackLine.
	* Option 'prinkMark' determines if these are printed in the log, default true.
	*
	* @any-order
	*   @params string|number  marks  	One or more marks to use
	*   @param function        func		The function to wrap
	*
	* @return function 	
	*/
	function markFunction(){
		var marks=[],func;
		for(let arg of Array.from(arguments)){
			if(typeof arg=='function')
				func=arg;
			else
				marks.push(arg);
		}

		//If we got more than one mark we call this func recursively
		if(marks.length>1)
			func=markFunction(...marks.slice(1),func);

		//Grab the mark we're working with...
		var mark=makeMark(marks[0])

		//Now we create an object and dynamically set a method on a prop called $mark, which will cause $mark to show 
		//up in all stack traces nested below...
		var obj={};
		obj[mark]=(self,args)=>func.apply(self,args);

		//Then return, without calling, a function that calls ^
		return function(){return obj[mark](this,arguments)}
		
	}


	/*
	* Apply a function, but mark the call stack so calls further down the tree can be identified. This allows "grouping"
	* of entries from different logs. The mark is identfied by getStackArray()
	*
	* @param string   mark	
	* @param function func     The function to call
	*
	* @return mixed 	Whatever $func returns
	*/
	function markAndRun(mark,func){
		return markFunction(mark,func)();
	}


































	/*
	* Constructor
	*
	* @param any 	unit 			Something to identify the log when filtering later. MUST BE UNIQUE
	* @param object options
	*/
	function BetterLog(unit,options={}){
		if(!this instanceof BetterLog){
			console.error(this);
			throw new Error("BetterLog should be newed. Called as: see log");
		}

		const self=this;

		Object.defineProperty(this,'_isBetterLog',{value:true});

		if(options=='debug')
			options={autoPrintLvl:1};

		this.options=Object.assign({},defaultOptions,options);

		//There are 2 ways to uniquely identify a log instance:
		// 	1. this.unit   arg#1        any      Preferably an object instance (which are unique by def)
		//  2. this.name   arg#2.name   string   The string that will be printed in each log. Defaults to this.toString()+integer. 
		if(typeof unit!='string' && BetterLog._instances.has(unit)){
			console.error('Existing BetterLog unit ',unit,BetterLog._instances.get(unit));
			throw new Error('BetterLog unit already exists (see previous console.error)');
		}else{
			this.unit=unit; 
			  //^NOTE: will get changed by changeName if it's a string and another options.name was passed, but we set it here so 
			  //       this.toString() in this.changeName() works
		}

// try{

		//Find and set a unique name for this instance. NOTE: this will also set an alias on ._instances
		this.changeName(this.options.name)
		  //if no name is passed it'll default to this.toString()+integer
// }catch(e){
// 	console.log(this);
// 	console.log(this.__proto__)
// 	throw e
// }



		//First instance => set start time
		if(!startTime)
			this.resetStartTime();

		/*
		* @prop array entries 	All entries of this array. Gets appeneded by BetterLogEntry.exec()
		*/
		this.entries=Array();


		//Secret array to hold all listeners to this log
		Object.defineProperty(this,'_listeners',{value:[]});



		//If we're appending another log (or the syslog) then all entries emitted by this log (see .exec()) will
		//be added to the other log and re-emitted there. The first log to print the entry will freeze the id
		{
			let otherLog=this.options.appendLog||(this.options.appendSyslog ? BetterLog._syslog:null);
			if(otherLog && otherLog._isBetterLog){
				
				if(otherLog!=BetterLog._syslog)
					otherLog.debug(`This log will be appended with entries from '${this.name}'`,this); //otherLog is already setup...

				this.listen((entry)=>{
					entry.exec(otherLog);
					let id=otherLog.entries.push(entry)-1; 
					try{entry.id=id}catch{}; //if entry.print() has been called the id can no longer be changed
					otherLog.emit(entry);
				})
			}
		}



		/*
		* @prop object codes 	Keys are short strings or numbers, values are longer descriptions. Useful when building 
		*						a wrapper around something which throws codes which you would otherwise need to lookup 
		*						their meaning, eg:
		*	html error   - { 416 : 'Requested Range Not Satisfiable' }
		*	socket error - { 1003: "Policy violation: Unsupported data type (e.g. endpoint only understands text data, but received binary)."} 
		*
		* NOTE: Used by this.makeErrorCode
		*/
		this.codes={};



		//To enable passing logging functions to iterators or as callbacks we define several shortcuts
		//on this instance, bound to this instance (or using self-object)

			//Define methods for each of the log levels on 'this', bound to this instance, so we don't have 
			//to worry about context when calling them (eg. when passing them)
			function callBetterLogFunc(obj,mark,msg,...extra){
				//^ NOTE: So we can easily filter away calls to within this file even in complex circumstances 
				//        we make sure the name of the func includes 'BetterLog'
				try{
					//If we're ignoring below this level, just return the fakeEntry
					if(obj.nr>=this.options.lowestLvl){
						this.makeEntry.apply(this,[obj.nr,msg].concat(extra)).setMark(mark).exec();
					}

				}catch(err){
					try{
						console.error(`BUGBUG BetterLog.${obj.str}() called with:`,arguments);
						console.error(err, err.stack);
					}catch(e){
						console.error(e,e.stack);
					}
				}

				//Unlike makeEntry/makeError etc. this func doesn't return the entry so when ignoring lower levels 
				//in production we know not to use these shorthands, if we need the entry we just makeEntry explicitly
				return this;
			}
			logLvl.forEach(obj=>{
				Object.defineProperty(this, obj.str, {
					enumerable:true
					,value:callBetterLogFunc.bind(this,obj,undefined)
				})
			})


		//This can be called as log.mark('foo').info(blabla)
		this.mark=function(mark){
			var dummy={};
			logLvl.forEach(obj=>dummy[obj.str]=callBetterLogFunc.bind(this,obj,mark));
			return dummy;
		}


		/*
		* Alias for .info (so a better log instance can be passed as console...)
		*/
		Object.defineProperty(this,'log',{enumerable:false, writable:true, configurable:true, value:this.info});

		/*
		* @see this.makeTrace()
		*
		* @return <BetterLog> 
		*/
		this.traceFunc=function(){
			try{
				if(self.options.lowestLvl==1){
					//Make a trace, then proceed like regular logging, appending it, emitting it, printing it...
					self.makeTrace.apply(self,arguments).exec();
				}
			}catch(err){
				console.error('BUGBUG',err);
			}
			return this;
		}

		/*
		* Works like this.trace but it adds 'Called from' handling
		*
		* @return <BetterLog> 
		*/
		this.traceCalled=function(msg,...extra){
			try{
				if(self.options.lowestLvl==1){
					self.makeEntry(1,msg,...extra).calledFrom().exec();
				}
			}catch(err){
				console.error('BUGBUG',err);
			}
			return this;
		}



		/*
		* Log and throw a <BLE>
		* @throws <BLE>
		* @return n/a
		*/
		this.throw=function(...args){
			self.makeError.apply(self, args).exec().throw(); //will also print if autoPrintLvl<6
		}

		/*
		* Like this.throw(), ie. creating and executing a new error, but if an older/bubbled/original error is detected
		* then that get's thrown instead
		*
		* @throws <BLE>
		* @return n/a
		*/
		this.throwOriginal=function(...args){
			self.makeError.apply(self, args).exec().getFirstBubble().throw();
		}

		/*
		* Similar to this.throw(), but .typeError() is used instead of .error() (which also implies that nothing
		* gets printed)
		*
		* @throws <ble TypeError>
		* @return void
		* @no_print
		*/
		this.throwType=function(...args){
			self.makeTypeError.apply(self,args).throw();
		}


		/*
		* Log, then return rejected promise
		* @return Promise(n/a,<BLE>)
		*/
		this.reject=function(...args){
			var entry=self.makeError.apply(self, args).exec() //will also print if autoPrintLvl<6
			
			// return Promise.reject('[@ '+entry.func+'()] '+String(entry.message)); //2019-03-16: Why only reject with string?? trying to change...
			return Promise.reject(entry);
		}

		/*
		* Like this.throwType(), but a we return a rejected promise instead
		* @throws <BLE>
		* @return void
		*/
		this.rejectType=function(){
			try{
				self.throwType.apply(self,Object.values(arguments));
			}catch(err){
				return Promise.reject(err);
			}
		}

		/*
		* Print out entry, making it visibly noticeble, regardless what the lowest listening level is set to
		* @return <BLE>
		*/
		this.highlight=function(...args){
			//If no predefined color was specified, assume we didn't specify a color at all so arg#1 is really arg#2 as so on...
			var color;
			if(typeof args[0]=='string' && highlightColor.hasOwnProperty(args[0])){
				color=args.shift();
			}
			//if no color get's set BLE.highlight(undefined) will use the color of the level... 

			//If no level was given, default to 'note'
			if(!logLvl.hasOwnProperty(args[0])){
				args.unshift('note');
			}


			//Now create, colorize, print and return the entry 
			return self.makeEntry.apply(self,args).highlight(color).exec('force');
		}

		/*
		* Creates BLE error and sets a code.
		*
		* @return <BLE>
		* @not_printed
		*/
		this.makeErrorCode=function(code,...args){
			//If the code matches one stored on this BetterLog... 
			if(self.codes[code])
				args.unshift(self.codes[code]);  //...prepend $args with said description, ie. making it the first part of the message
		
			return self.makeError(...args).setCode(code);
		}

		/*
		* Create and throw a BLE with a code. 
		*
		* @throws <BLE>
		* @return n/a
		* @not_printed
		*/
		this.throwCode=function(...args){
			throw self.errorCode(...args);
		}

	//done defining bound shortcuts..



	}//End of BetterLog constructor
	
	BetterLog._instances=BetterMap();
	
	BetterLog._BetterLogEntry=BetterLogEntry;
	
	BetterLog.varType=varType;
	BetterLog.logVar=logVar;
	BetterLog.prepareInFileMarker=prepareInFileMarker;
	BetterLog.discardLinesBetweenMarkers=external_discardLinesBetweenMarkers;
    BetterLog.BetterMap=BetterMap;
	BetterLog.isBetterLog=isBetterLog;
	BetterLog.debugMode=debugMode;
	BetterLog.SimpleSourceMap=SimpleSourceMap
	BetterLog.prototype.markFunction=BetterLog.markFunction=markFunction;
	BetterLog.prototype.markAndRun=BetterLog.markAndRun=markAndRun;



	/*
	* Terminology:     this.name        a unique string identifier
	*                  this.unit        a unique identfier, can be live object
	*                  this.toString()  a common identifier for all logs created from the same place, eg. in some other objects constructor
	*
	* @return string
	*/
	BetterLog.prototype.toString=function(){
		//In case this is somehow called on something other than an instance of BetterLog then use the 
		//default toString() function
		if(!this || !this._isBetterLog){
			return Object.prototype.toString.call(this);
		}

		switch(typeof this.unit){
			case 'string':
				return this.unit;
			case 'function':
				return this.unit.name;
			case 'object':
				if(this.unit) //guard against null
					return this.unit.constructor.name;
			default:
				return 'unknown_BetterLog_instance';
		}

	}


	/*
	* Set the name of this instance. Used by the constructor but can also be used later. Useful eg. if you change
	* the constructor of a unit etc. 
	*
	* NOTE: This doesn't prevent the old name to or unit from being used to access this instance, instead an alias
	*		is created on Binder._instances
	*
	* @opt string name 	Defaults to this.toString()
	*
	* @return string 	The name set after this operation
	*/
	BetterLog.prototype.changeName=function(name){
		//Make sure we have a string
		name=(typeof name=='string'?name:'')||this.toString();
		
		//Bail if the same name is already set, else check if an old alias needs removing
		if(name==this.name)
			return name;
		else if(this.name && BetterLog._instances.aliases.has(this.name))
			BetterLog._instances.aliases.delete(this.name);

		//NOTE: The reason we use aliases^ instead of a second seperate map is so that you can 
		//call BetterLog._instances.get(...) with both name and unit. And the reason we
		//don't use a single map is because that would affect .size() and .forEach()


		//Normally this.unit is an instance of some object who's constructor created this log, but in case this.unit is a string 
		//it needs to get changed too since both this.unit and this.name should be unique
		if(typeof this.unit=='string'){
			if(BetterLog._instances.has(this.unit))
				BetterLog._instances.delete(this.unit);
			this.unit='';
		}

		//Now we need to make sure we have a unique name
		var base=name,i=0;
		while(BetterLog._instances.has(name)){
			i++
			name=base+i;
		}

		//Finally we set the name, unit, instance and alias
		this.name=name;
		this.unit=this.unit||this.name;
		if(!BetterLog._instances.has(this.unit))
			BetterLog._instances.set(this.unit,this);
		if(this.name!=this.unit)
			BetterLog._instances.aliases.set(this.name,this.unit)


		return this.name;
	}






















	

	/*
	* Intercept all logs during the running of a function
	*
	* NOTE: For this to work :
	*           A) the entry has to be appended to this log, so best is to do it on syslog
	*           B) the lowestLvl for each log involved has to be low enough
	*
	* @param function|string interceptOrPrefix  A listener function that will intercept all log entries emitted during 
	*                                           the run, or a string to prefix to the source of each entry
	* @param function func                      The function to run (it should be bound with all args it needs)
	* @param flag 'debugMode'                   Will set lowestLvl=1 temporarily if passed
	*
	* @return mixed    Whatever $func returns
	*/
	BetterLog.prototype.runAndInterceptLogs=function(func,intercept,debugMode){

		//Create the mark and then start listening for it, calling the intercept anytime we find it
		var interceptedAt=this.getStackArray((new Error()).stack);
		var mark='_intercept'+Math.floor(Math.random() * 1000000);
		var listener=(entry)=>{if(entry.hasMark(mark)){entry.addHandling('Intercepted',interceptedAt);intercept(entry);}};
		this.listen(listener);
		
		if(debugMode=='debugMode')
			var turnOff=debugMode('on');
			
		var stopIntercepting=()=>{
			this.ignore(listener);
			if(turnOff) //Only turn off if we turned it on
				debugMode('off');
		}


		//Now run the function...
		try{
			var result=markFunction(mark,func)();
		}catch(e){
			var error=e
		}

		//...and when it finishes stop intercepting
		if(varType(result)=='promise'){
			result=result.then(
				success=>{stopIntercepting();return success;}
				,error=>{stopIntercepting();return Promise.reject(error);}
			)
		}else{
			stopIntercepting();
		}

		//Finally return what may be a promise or some other result
		if(error)
			throw error;
		else
			return result;
	}




		




















/********************** Create entries *******************************/





	/*
	* Create <BLE> without printing or storing anything
	* @return <BLE>
	*/
	BetterLog.prototype.makeEntry=function(lvl,msg,...extra){

		//Get a lvl number (and deal with people forgetting lvl altogether)
		var logLvl=getLvlNr(lvl,'a');
		if(logLvl=='a'){
			if(msg!=undefined)
				extra.unshift(msg);
			msg=lvl;
			lvl=3;
		}

		//If msg is a BLE, just change .lvl, .log and add .extras, but don't create a new instance
		if(isLiveBLE(msg)){
			
			msg.lvl=logLvl;
			msg.log=this;
			if(extra.length){
				msg.addExtra(...extra);

				//Since we've added stuff, the whole thing is no longer printed... However this
				//will cause re-print of previously printed stuff, so try to avoid adding extras
				//this way
				msg.printed=false;
			}
			return msg;

		} else {
			//...else create a new one (it will handle regular Errors etc...)
			return this.makeEntryRaw(lvl,msg,extra);
		}
	}
	


	/*
	* @see makeEntry('error',...)
	* @return <BLE Error>
	*/
	BetterLog.prototype.makeError=function(...args){
		args.unshift(6); //lvl 6==error
		return this.makeEntry.apply(this,args);
	}




	/*
	* Creates an entry that will print (but doesn't here) like:
	*   [ appSocket.uniSoc.] - TRACE - receiveSmarty( (number)742354341 ) from args.callback (uniSoc3.common.js:1247:19) @ uniSoc3.common.js:1278:11.
	*
	* @param object|array args 	 	The arguments object or an array of args
	* @param @opt string funcOrMsg  If it doesn't contain spaces it's used instead of entry.func at start of msg, else 
	*							   	  it's appeneded to the end of the msg
	* @param @opt number logLvl 	Default 1=trace
	*
	* @return <BLE>
	* @no_print
	*/
	BetterLog.prototype.makeTrace=function(args, funcOrMsg,logLvl=1){
		
		//Make sure we have a number
		logLvl=getLvlNr(logLvl);

		//Allow legacy, ie. reverse order of arguments...
		if(typeof args=='string'){
			var a=args;
			args=funcOrMsg;
			funcOrMsg=a;
		}

		var logStr;
		if(typeof args!='object'){ //includes array, arguments-object and null
			logStr='( ? )'
		}else{
			//Turn the args array into a string that can be logged/stored without worrying
			//that it'll take up space or change later
			logStr='( '+(args.length==0?' void ':Object.values(args).map(arg=>logVar(arg,50)).join(' , '))+' )';
		}
			
		//Then just like with regular logging, create the this...
		var entry=this.makeEntry(logLvl,logStr,undefined);

		//...but modify it a bit before proceeding
		if(funcOrMsg && typeof funcOrMsg=='string'){
			//If arg #2 contains spaces, it's a message, else a func name
			if(funcOrMsg.includes(' ')){
				entry.addExtra(funcOrMsg);
			}else{
				entry.func=funcOrMsg;
				entry._options.printFunc=true;
			}
		}

		entry.addFrom();

		return entry;
	}



	/*
	* Create an error with code 'TypeError'. Handles differently for terminal and browser.
	*
	* @param string|array|object|function expected 	Gets turned into a string and goes after 'Expected ' in the msg
	*
	* @return <ble TypeError>
	* @no_print
	*/
	BetterLog.prototype.makeTypeError=function(expected,...got){
		switch(varType(expected)){
			case 'array':
				expected=expected.join('|');
				break;
			case 'object':
				expected='instanceof '+expected.constructor.name;
				break;
			case 'function':
				expected='instanceof '+expected.name;
				break;
			case 'string':
				break;
			default:
				expected='(bugbug)'+String(expected); //this should not happen, but best effort...
		}
		let msg=`Expected ${expected}, got: `;
		if(BetterLog._env=='terminal'){
			return this.makeError(msg+got.map(arg=>logVar(arg,100)).join(', ')).setCode('TypeError');
		}else{
			return this.makeError.apply(this,[msg].concat(got)).setCode('TypeError');
		}
	}








//---------------------- ^^ Create entries ^^ ---------------------------/


















	
/****Rudimentry event emitter, used to emit log entries****/

	/*
	* Emit an entry
	* @return void
	*/
	BetterLog.prototype.emit=function(entry){
		try{
			//Quick check to see if there's anyone to emit to
			if(!this._listeners.length)
				return;

			//Emit to the last added first, that way we can add handlers later to preempt earlier logging (good
			//if we want to add extra detail to something at a later stage, and don't want duplicates because of it)
			var i=this._listeners.length-1
			for (i; i >= 0; i--) {
				if(!this._listeners[i])
					continue;

				//Listeners are added with a span of levels they want... ignore if outside
				var arr=this._listeners[i]; //[cb,low,high]
				if(entry.lvl<arr[1] || entry.lvl>arr[2])
					return;

				try{
					arr[0](entry);
				}catch(err){
					console.error(`Uncaught error in BetterLog listener ${i}:`,err,arr[0],entry)
				}
			}
		}catch(err){
			console.error(`BUGBUG BetterLog.emit():`,err,entry);
		}
	}
	
	/*
	* Add a listener
	* @return number 	The id of the listener, in case we want to remove it later
	*/
	BetterLog.prototype.listen=function(callback,lowestLvl=1,highestLvl=6){
		if(typeof callback!='function')
			callback=BetterLog.prototype.print;

		return this._listeners.push([callback,getLvlNr(lowestLvl,1),getLvlNr(highestLvl,6)])-1;
	}

	/*
	* Remove a listener
	* @param number|function id 		The id returned by .listen(), or the callback passed to it
	* @return void
	*/
	BetterLog.prototype.ignore=function(x){
		if(this._listeners.hasOwnProperty(x)){
			delete this._listeners[x]; //NOTE: delete, don't splice, so that id of others don't change
		}else{
			while(this._listeners.indexOf(x)>-1)
				delete this._listeners[this._listeners.indexOf(x)]
		}
	}















	/*
	* Add entries from another log to the current one, emitting again...
	*
	* @param <BetterLog> anotherLog 	Another instance of BetterLog
	*
	* @return number 	@see anotherLog.listen()
	*/
	BetterLog.prototype.extend=function(anotherLog){
		if(!isBetterLog(anotherLog)||anotherLog===this)
			throw new TypeError("Expected another instance of BetterLog, got: "+logVar(anotherLog));

		var self=this;
		return anotherLog.listen(function extend(entry){
			self.entries.push(entry);
			self.emit(entry);
		})
	}


	/*
	* Move all entries from this log to another, changing the log-reg on them, then removing this log from _instances
	*
	* NOTE: this will NOT re-emit anything, simply move the entries over
	*
	* @param <BetterLog> anotherLog 	Another instance of BetterLog
	*
	* @return @anotherLog 				The passed in log, to enable one-liners:  obj.log=obj.log.replace(newLog)
	*/
	BetterLog.prototype.replace=function(anotherLog){
		if(!isBetterLog(anotherLog)||anotherLog===this)
			throw new TypeError("Expected another instance of BetterLog, got: "+logVar(anotherLog));

		this.note("This log will be replaced by: ",anotherLog.name);

		var i=0;l=this.entries.length;
		anotherLog.debug(`Replacing log '${this.name}'. Grabing it's ${l} entries.`);
		for (i;i<l;i++) {
			anotherLog.entries.push(this.entries[i]);
		}
		
		BetterLog._instances.delete(this.unit);

		return anotherLog;
	}





	/*
	* Reset the startTime used by options.printMs
	* @return void
	*/
	BetterLog.prototype.resetStartTime=function(){
		startTime=Date.now();
	}


	/*
	* Get entries from a specific unit or the syslog (can be called on or outside instance)
	*
	* @param string|number  lowestLvl 	Lowest level to include
	* @param object 		unit 		Log to get from. Null=>syslog. Default this log
	* 
	* @return array 					A subset of the syslog array
	*/
	BetterLog.prototype.get=function(lowestLvl=1,unit){ 
		lowestLvl = getLvlNr(lowestLvl,1);
		
		//If no unit is specified and we're calling this on an instance => only look at entries 
		//from the instance itself
		var entries;
		if(unit){
			let log=BetterLog._instances.get(unit);
			if(!log){
				console.warn("No such BetterLog unit setup:",unit);
				return [];
			}
			entries=log.entries;
		}else if(unit===null || !(isBetterLog(this)))  
			entries=BetterLog._syslog.entries;
		else
			entries=this.entries; //default, if nothing is specified

		return entries.filter(entry=>entry.lvl>=lowestLvl); 
	}


	/*
	* Find entries in any log
	*
	* @param object criteria 	Acceptable keys and their values: 
	*								lowestLvl - number
	*								unit - string
	*								printed - boolean
	*								id - number(from)|array[from,to]
	*								timestamp - number(from)|array[from,to]
	*								rocks - boolean|number (true or id, get the rocks from entries found so far)
	*								match - string|regexp
	*
	* @return array|false
	*/
	BetterLog.prototype.find=function(criteria={}){
		var entries=this.get(criteria.lowestLvl||1, criteria.unit); 
		if(!entries.length)
			return [];

		

		if(criteria.hasOwnProperty('printed'))
			entries.filter(entry=>entry.printed==criteria.printed);
		if(!entries.length)
			return [];

		if(typeof criteria.rocks=='number')
			criteria.id=[criteria.rocks, criteria.rocks];

		Array('id','timestamp').forEach(p=>{
			if(criteria[p]){
				if(Array.isArray(criteria[p]))
					entries=entries.filter(entry=>entry[p]>=criteria[p][0] && entry[p]<=criteria[p][1]);
				else{
					entries=entries.filter(entry=>entry[p]>=criteria[p]);
				}
				
				if(!entries.length)
					return [];
			}
		})


		//Only get entries that have no more rocks, ie. probably the errors that have been logged, dropping
		//all their bubbles
		if(criteria.rocks){
			var getRocks=(entry)=>{
			    var arr=[entry];
				if(entry._rocks.length){
			    	// console.log('looping through',entry._rocks.length,entry)
				    entry._rocks.forEach(rock=>{
			            arr.push.apply(arr,getRocks(rock))
				    })
				}
				return arr;
			}
			let entries2=[];
			entries.forEach(entry=>entries2.push.apply(entries2,getRocks(entry)));
			entries=entries2.filter(entry=>entry._rocks.length==0);
		}

		
		
		
		if(criteria.match){
			entries=entries.filter(entry=>{
				try{
					return entry.match(criteria.match);
				}catch(err){
					return false;
				}
			})
		}

		return entries;
	}


	/*
	* Print the whole log (or syslog if called not-on-instance)
	* 
	* @opt object options
	* @opt object|array criteria
	* @opt boolean noVerbose       If true nothing will be printed as console.verbose
	*
	* @return void
	*/
	BetterLog.prototype.dump=function(options=undefined,criteria=undefined,noVerbose=true){
		//Set some default options, letting passed in ones overrule...
		options=Object.assign({
			printMs:false //printing ms will give negative numbers if startTime has been reset, so just turn it off
			,printMethod:noVerbose?{1:console.log,2:console.log}:undefined
		},typeof options=='object'?options:undefined);
		
		//Using the criteria^, get the entries we want to dump
		switch(varType(criteria)){
			case 'object':var entries=this.find(criteria); break;
			case 'array':entries=criteria; break;
			default:entries=this.get();
		}

		//The entries may not all be from the same log, or may not all have been filtered out, which means that bubbles saying
		// "See entry..." is not a good idea if the bubbles themselves are not part of the dump...
		let includedInThisDump=(bubble,i)=>{if(!bubble.id){return false}; for(i;i>=0;i--){if(entries[i]==bubble){return true;}}return false;}
		for(let i=0;i<entries.length;i++){
			let entry=entries[i];
			while(entry.bubble){
				let bubble=entry.bubble;
				if(bubble.printed && !includedInThisDump(bubble,i))
					bubble.printed=false;
				entry=bubble;
			}
		}
		
		if(!entries.length)
			console.log("No matching entries found.");
		else{
			console.group('--- Log Dump ---');
			console.log(arguments);
			entries.forEach(entry=>{entry.print(options)});
			console.groupEnd();
		}
		return;		
	}


	/*
	* Get the last entry from this log
	* @return <BLE>
	*/
	BetterLog.prototype.last=function(){
		return this.entries[this.entries.length-1];
	}


	/*
	* Store the last log entry to a hidden prop on an object
	*
	* @param object obj               $see ble.storeOnObject()
	* @opt boolean dontStoreIfFalse   $see ble.storeOnObject()
	*
	* @return <BLE>
	*/
	BetterLog.prototype.storeLastOnObject=function(obj,dontStoreIfFalse){
		return this.last().storeOnObject(obj);
	}
	/*
	* Alias so it's the same as BetterLogEntry... 
	*/
	BetterLog.prototype.storeOnObject=BetterLog.prototype.storeLastOnObject;

















	/*
	* Utility function, gives more descriptive type of variable
	*
	* @return string     Beyond the regular 
	*						object,bigint,symbol,string,number,boolean,function,undefined 
	*					it can also return
	*						null,array,ble,error,promise,nodelist,node
	*					if something goes wrong it returns:
	*						unknown
	*/
	function varType(v){
		if(typeof v === 'object'){
			if(v==null){
				return 'null';
			}
			switch(v.constructor.name){
				case 'Object':
					if(v.hasOwnProperty('callee') && v.hasOwnProperty('length') && Object.getOwnPropertySymbols(v).map(String)=='Symbol(Symbol.iterator)'){
						return 'arguments';
					}
					return 'object';
				case 'Array':
					return 'array';
			}					   
			if(v instanceof Error){
				return 'error';
			}
			if(v instanceof Promise){
				return 'promise';
			} 
			var name = Object.prototype.toString.call(v)
			if (name === '[object HTMLCollection]' || name ==='[object NodeList]'){
				return 'nodelist'
			}else if(name.includes('[object HTML') || name.includes('[object SVG')){
				return 'node'
			}else{
				return 'object';
			}
			
		} else {
			let type=typeof v;
			if(type=='string'||type=='number'||type=='boolean'||type=='function'||type=='undefined'||type=='bigint'||type=='symbol'){
				//These are the values it's allowed to return, for anything else it will return 'unknown'vv
				return type;
			}else{
				console.warn('Unexpected typeof:',type,v);
				return 'unknown';
			}

			//Can return: bigint,symbol,string,number,boolean,function,undefined
		}
	}

	/*
	* Turn any variable into a log:able string, prepended by the type of the variable
	*
	* @param any v 	            The variable to log
	* @opt number maxLength     The max number of characters of the resulting string
	* @opt flag 'noType'        Don't prenend the type
	* @opt number total 		Used internally. 
	* 
	* @return string 	
	*/
	function logVar(v,maxLength=300,...optional){
		var total=optional.find(opt=>typeof opt=='number');
		var noType=typeof total=='number' || optional.includes('noType');
		
		var type=BetterLog.varType(v);
		var printType='<'+type+'>';
		switch(type){ 
			case 'undefined':
			case 'null':
				return printType;
			case 'error':
				return `<${v.toString()}>`; //will be '<Error: message...>'  same as vv

			case 'object':
				if(v.isBLE){
					if(v.isBLE=='json')
						v=BetterLog._syslog.makeEntry(v.lvl, v);					
					return `<${v.toString()}>`;                            // same as ^^
				}
				//"regular" objects like {foo:'bar'}, leave type as 'object' and stringify value
				if(v.constructor.name=='Object'){
					// console.log('a')
					v=makeJsonLikeString(v,maxLength,type,total);
					break;
				}

				//The object may be a prototype... in which case we will want to know that...we've decided...
				if(v.hasOwnProperty('constructor') && typeof v.constructor=='function' && v.constructor.prototype==v){
					printType='<prototype:'+v.constructor.name+'>'
				}else{
					//all other objects we'll print their types as the constructor name...
					printType='<'+v.constructor.name+'>'
				}

				//...and values in both cases^:
				var x=String(v),y=Object.prototype.toString.call(v)
				if(y!=x){
					//use the custom toString()...
					// console.log('String():',x)
					// console.log('Object.prototype.toString.call():',y)
					// console.log('using custom toString instead of trying to json-like this:',v);
					v=x; 
					//...then make sure it gets shortenend (since type==object doesn't get shortened vv)
					type='changing this to an arbitrary string so it gets shortened vv';
				}else if(total){
					//if a total is passed, just return the constructor name... //2020-07-20: why? since it's most likely called 
					//from makeJsonLikeString() recursively
					return printType;
				}else{
					//start calling makeJsonLikeString() which may call this method again recursively
					v=makeJsonLikeString(v,maxLength,type,total);
				}
				
				break;

			case 'arguments':
				printType='<arguments:'+v.length+'>'
				v=Array.from(v);
				//let fall through
			case 'array':
				// console.log('going to make array to string length',maxLength)
				v=makeJsonLikeString(v,maxLength,type,total);
				break;

			case 'function':
				var fnStr=String(v)
				v=fnStr.slice(0, fnStr.indexOf(')')+1);
				if(v.indexOf('function')>-1){
					v+='{}';
					if(maxLength=='x')
						return v;
					v=v.replace('function ','');
				}else
					v+='=>{}';
				break;
			case 'node':
				let id=v.id?'#'+v.id:''
				let cls=v.classList.length?'.'+v.classList.toString().replace(' ','.'):'';
				v=v.tagName.toLowerCase()+id+cls
				break;

			case 'string':
				printType=''; //trying without since we've wrapped it in "" vv
				v=`"${v}"`;
				break;
			case 'promise':
			default:
				v=String(v);
			
		}
		//At this point we have a string...


		//Handle too long
		if(maxLength&&(v.length>maxLength) &&type!='object'&&type!='array'&&type!='arguments'){
			 //^no need to worry about objects etc wince they have been taken care of by makeJsonLikeString()
			let m=v.match(/([\}\]\)"])$/);
			v=v.substr(0,maxLength-3)+'...';
			if(m)
				v+=m[1]
		}

		if(noType)
			return v
		else
			return printType+v
	}
	
                            


	/*
	* Turn any var into a JSON-like string (BUT CANNOT BE PARSED TO OBJECT) that shows as much as
	* possible of the first level of an object
	*
	* NOTE: The maxLength can/will be exceeded by a little...
	*
	* @param object|array  	obj
	* @return string 				JSON-like string (BUT CANNOT BE PARSED TO OBJECT), or '<err:message>'
	*/
	function makeJsonLikeString(obj,maxLength,type,total=0){

		var str='';

		//So we don't loop unecessarily or waste time on super short ones... but if any errors happen
		//while trying to save time, just proceed to the loooong way of doing it...
		try{
			if(total){
				//this implies we're somewhere nested...
				if(total>(maxLength*5)){
					return String(obj); //just make sure we have something to write after a key...
				}else if(total>maxLength*3){
					return JSON.stringify(obj); //ignore hidden stuff or method
				}
			}else if(maxLength<51){
				//this implies we're at the top level
				str=JSON.stringify(obj);
				if(str.length>maxLength)
					str=str.substr(0,maxLength-4)+'...'+str.substr(-1);
				return str;
			}
		}catch(err){
			//see ^
		}
		
		try{		
			total++ //so that total is always >0 after the first time we've called this

			//If it contains any methods, they won't show up with stringify(), neither will non-enumerable props,
			//so we manually loop everything in the first level and stringify it, setting it or any errors on a 
			//temp object...
			var keys=Object.getOwnPropertyNames(obj);
			if(type!='object'){
				keys.splice(keys.indexOf('length'),1)//ignore the 'length' prop on arrays and arguments
				let i=keys.indexOf('callee')
				if(i>-1)
					keys.splice(i,1);
			}
			var simpleLogVar=function(x){
				var str=`<${typeof obj[key]}>`
			}
			var temp={},over=[],extra=0,i=0,l=keys.length,even=Math.floor(maxLength/l);
			for(i;i<l;i++){
				let key=keys[i];
				try{
					str=logVar(obj[key],maxLength,total);
					if(str=='<toLocaleString>')
						throw new Error(`BUGBUG: BetterLog.logVar() returned '<toLocaleString>'`);
				}catch(err){
					console.group();
					console.debug(`makeJsonLikeString() failed to stringify key '${key}':`);
					console.debug('OBJECT:',obj);
					console.debug('ERROR:',err);
					console.groupEnd();
					str=`<${typeof obj[key]}>`
				}
				temp[key]=str;
				let sl=str.length
				total+=sl
				if(sl<even)
					extra+=(even-sl)
				else
					over.push(key); //these props will be shortened or ignored
			}

			//Now shorten each item that exceeds the 'even' if we've exceeded the maximum
			if(type=='object'){
				let kl=keys.join('').length; //object keys will obviously take up space too
				total+=kl
				extra=Math.max(extra-kl,0);
			}

			if(total>maxLength){
				//Redestribute the extra (could be a lot if lots of props just have a single word/number). Since a bunch of tiny 
				//strings doesn't give us much info, only shorten the first 6
				var rest=over.splice(5,over.length);
				if(rest.length){
					keys=keys.filter(key=>rest.includes(key)==false);
					even=Math.floor(maxLength/over.length);
				}else{
					rest=undefined;
				}
				even+=Math.floor(extra/over.length);
				for(let key of over){
					if(temp[key].length>even){
						let short=temp[key].substr(0,even-3)+'...'+temp[key].substr(-1); //just assume the last char is } ] "
						// console.log(i,key,temp[key].length,' --> ',short.length)
						temp[key]=short;
					}
				}
			}

			var add=function(key){
				if(!obj.propertyIsEnumerable(key))
					str+='*'
				if(!String(temp[key]).startsWith(key)) //__proto__ won't be a string
					str+=`${key}:`
				str+=`${temp[key]}, `;
			}
			//Now build a JSON-like string from the parts
			if(type=='object'){
				str='{';
				keys.forEach(key=>add(key))
			}else{
				str='[';
				keys.forEach(key=>{
					if(!isNaN(Number(key))){
						str+=temp[key]+', '
					}else{ 
						add(key)
					}
				})
			}
			
			if(rest)
				str+=`<${rest.length} more>`
			else
				str=str.replace(/, $/,'');

			str+=(type=='object' ? '}' : ']');

			return str;

		}catch(err){
			console.group()
			console.debug('makeJsonLikeString() failed to stringify object:')
			console.debug('OBJECT:',obj);
			console.debug('ERROR:',err);
			try{
				var str=JSON.stringify(obj); //try again...
				str=str.substr(0,maxLength-4)+'...'+str.substr(-1);
			}catch(e){
				console.debug('ERROR:',e)
				str=`<err:Failed to convert object (see console.debug^) to JSON-like string>`;
			}
			console.groupEnd();
			return str;
		}
	}

    

	












	/*
	* Get the stack from a regular error
	* @opt string|<Error>
	* @return string        Eg: "Error: Error message \n     at......"
	*/
	function getStackStr(errOrStack){
		if(errOrStack){
			if(typeof errOrStack=='string')
				return errOrStack
			else if(errOrStack instanceof Error){
				return errOrStack.stack
			}else{
				console.warn(errOrStack);
				return (new Error('Bad err/stack passed (see warn^), generating one here...')).stack;
			}
		}else{
			return (new Error('No stack passed, generating one here...')).stack;
		}
		
		//Still running? Create a new stack
	}




	/*
	* Parse a native error stack and return an array of objects.
	*
	* NOTE: The only reason this method is on an instance and not static is so it can use the options of that instance
	*
	* @opt <Error>|string|array errOrStack		An error who's stack to use, or just the .stack string, or an array which
	*											has previously been returned by this method. If omitted one will be generated here. 
	*
	* @return array[{where,func}...] || array[{empty:true}]  Array of objects.
	*/
	BetterLog.prototype.getStackArray=function(errOrStack=undefined){
		var stackArr;
		if(Array.isArray(errOrStack)){
			stackArr=errOrStack;
		}else{
						
			let stackStr=getStackStr(errOrStack);

			//Some errors need special handling...
			if(stackStr.includes('SyntaxError:') && !stackStr.startsWith('Error')){
				stackArr=handleSyntaxErrorStack(stackStr).stackArr;
			}else if(stackStr.startsWith('ReferenceError: ')){
				stackArr=handleReferenceErrorStack(stackStr);
			}else if(stackStr.startsWith('Error: Cannot find module')){
				stackArr=handleModuleNotFoundStack(stackStr);
			}else if(stackStr.includes('circular structure to JSON')){
				stackArr=handleCircularJSONStack(stackStr);
			}else{
				//Now we either have an array or a string, the later must become the former
				stackArr = splitStackString(stackStr);
			}
		}

		if(!stackArr._isStackArr){
		
			//NOTE: duplicate lines are handled when we print...

			//Turn array of strings into array of objects: {func, where, orig, mark, file, line}
			stackArr=stackArr.map(parseStackLine)

			//Now handel depending on env.
			if(BetterLog._env=='browser'){
				//Browser code may be minified in which case we remove
				stackArr=discardLinesBetweenMarkers(stackArr,BetterLog._envDetails.first,BetterLog._envDetails.last);
			
			
			//For 'terminal' or 'inspector'... 
			}else{
				//Always remove all calls produced by this file
				stackArr=stackArr.filter(line=>line.mark||line.file.includes(__filename)==false);

				//optionally remove stack entries that refer to internal modules and have little informative
				//value to a developer of other modules
				if(this.options.hideInternalStack)
					stackArr=removeInternalStack(stackArr);

				//In terminal, since .where isn't an active uri we can shorten it...
				if(BetterLog._env=='terminal'){
					//...either showing filename only or at least making the path relative
					if(this.options.fileOnly)
						stackArr.forEach(line=>line.where=line.where.slice(line.where.lastIndexOf('/')+1))
					else
						stackArr.forEach(line=>line.where.replace(this.options.rootPath,'.'))
				}
			}
			
			//If a simpleSourceMap exists, apply it 
			if(BetterLog.SimpleSourceMap.length){
				stackArr.forEach(line=>line.where=BetterLog.SimpleSourceMap.lookup(line.where,true)||line.where);
			}
			
			Object.defineProperty(stackArr,'_isStackArr',{value:true,configurable:true,writable:true});
		}
		
		//Always make sure there is at least on one item in stack, that way we don't have to worry about errors
		if(!stackArr.length)
			stackArr.push({'empty':true})

		return stackArr


	}


	/*
	* Given a $stackArr, filter out any entries between a $first and $last marker
	*
	* NOTE: When this method is called from outside this file it'll be external_discardLinesBetweenMarkers() which is actually called
	*
	* @param array stackArr Array of objects all returned from @see parseStackLine(). *ALTERED*
	* @param object first   Return from @see prepareInFileMarker()
	* @param object last  	Return from @see prepareInFileMarker()
	* 
	* @param object $stackArr
	*/
	function discardLinesBetweenMarkers(stackArr,first,last){
		if(first && first.file && last && last.file){
			var i=stackArr.length-2;
			for(i;i>=0;i--){
				if(!stackArr[i].mark && isBetweenMarkers(stackArr[i],first,last))
					stackArr.splice(i,1);
			}
		}else{
			console.warn("EINVAL: Cannot filter lines in file. Args:",arguments);
		}
		return stackArr;
	}

	/*
	* Used by discardLinesBetweenMarkers() only
	*
	* @return boolean 	True if $line is between $first and $last, else false (even on error)
	*/
	function isBetweenMarkers(line,first,last){
		try{
			if(line.file!=first.file)
				return false;

			if(line.line<first.line||line.line>last.line)
				return false;

			//The markers will never be from the same line UNLESS the file has been minified...
			if(first.line==last.line){
				if(line.pos<first.pos||line.pos>last.pos)
					return false;
			}
			
			return true;
		}catch(err){
			//Best effort, point is we could determine if it was between... so just say it wasn't
			return false;
		}
	}

	/*
	* External version of @see discardLinesBetweenMarkers(). It allows "unprocessed" args
	*/
	function external_discardLinesBetweenMarkers(stackOrError,firstOrError,lastOrError){
		return discardLinesBetweenMarkers(
			BetterLog._syslog.getStackArray(stackOrError)
			,prepareInFileMarker(firstOrError)
			,prepareInFileMarker(lastOrError)
		)
	}


	/*
	* Remove lines from stack that refer to internal stuff
	*
	* @param array(object) stackArray  @see getStackArray()
	*
	* @return array
	*/
	function removeInternalStack(stackArr){
		return stackArr.filter((obj,i)=>{
			//always keep first line of stack
			if(i===0){
				return true;
			}

			if(
				obj.where.startsWith('node:internal/')
				|| obj.where.startsWith('internal/')
				|| obj.where.startsWith('vm.js:')
				|| obj.where.startsWith('module.js:')
				|| obj.where.includes('bootstrap_node.js:')
			){
				return false;
			}
			
			return true;
		})
	}


	/*
	* Some SyntaxErrors contains more information at the begining of the stack, ie. information that is not
	* part of the message, this splits it appart
	*
	* @return array
	*/
	function handleSyntaxErrorStack(str){
		var obj={stackArr:[],description:''};
		try{
			var isDescription=true
				,arr=str.split(/\r\n|\r|\n/)
				,len=arr.length
			;
			//The very first line is part of the stack, the place where the syntax error actually occured, but it's 
			//missing some fluff which is needed for the regexp in parseStackLine to work
			obj.stackArr.push('at _SyntaxError_ ('+arr[0]+':0)');

			//The next few lines are an exert from the script that shows the error, this is NOT part of the err.message
			//and as such we save it to use later...
			for(let i=1; i<len; i++){
				let trimmed=arr[i].trim();
				if(trimmed){
					if(isDescription){ 
						if(arr[i].includes('SyntaxError:')){
							isDescription=false;       //this line is ignored as it's the err.message
						}else{
							obj.description+=arr[i]+'\n'; //add the untrimmed line since it may be '     ^^^^^'
						}
					}else{
						obj.stackArr.push(trimmed);
					}
				}
			}
		
			//Remove empty descriptions, prepend rest with newline to make it easier to read
			if(!obj.description || obj.description.match(/^\s*$/))
				obj.description=''
			else
				obj.description='\n'+obj.description;

		}catch(err){
			BetterLog._syslog.makeError(err,str).setCode("BUGBUG").exec();
		}
		return obj;
	}

	/*
	* Circular JSON errors have several lines of at the start of the stack which need removing...
	*
	* @return array
	*/
	function handleCircularJSONStack(str){
		let needle='closes the circle';
		let i=str.indexOf(needle);
		if(i>-1){
			str=str.substr(i+needle.length);
		}
		let arr=splitStackString(str);

		if(arr[0].includes('JSON.stringify'))
			arr.shift()
		
		return arr;
	}

	// /*
	// * Some SyntaxErrors contains more information at the begining of the stack, ie. information that is not
	// * part of the message...
	// *
	// * @param <SyntaxError> err
	// *
	// * @return string      More information about the error, or an empty string
	// */
	// function getSyntaxErrorDescription(err){
	// 	var description=''
	// 		,arr=err.stack.split(/\r\n|\r|\n/)//NOTE: not a <ble>
	// 		,l=arr.length 
	// 	;
	// 	for(let i=0;i<l;i++){
	// 		if(arr[i].match('SyntaxError: '))
	// 			break;
	// 		description+='\n'+arr[i] 
	// 		 //DevNote: if we put \n after^ we get correct newlines, but we get problems with indents... try it...
	// 	}
	// 	return description;
	// }


	/*
	* NOTE: The returned array from this method continues to be processed by getStackArray()
	*
	* @return array[string,...]
	*/
	function handleReferenceErrorStack(str){
// console.log(str);
		var arr = str.split(/\r\n|\r|\n/), stackArr;

		//The Reference stack can look in 2 ways:
		/*
			<FIRST LINE OF STACK>
				<the string that is the problem>
					<indication where the problem is ^^^^^>

			ReferenceError: ......
				at <SECOND LINE OF STACK>
				at ...
		*/
		//  or
		/*
			ReferenceError: ......
				at <FIRST LINE OF STACK>
				at ...
		*/
		//and in both cases we need all the lines, so check which one we have
		if(arr[0].substr(0,15)=='ReferenceError:'){
			//Just discard first line and return rest
			arr.shift(); 
// console.log('returning all but first line',arr)
			return arr;
		
		}else{
// console.log('FIRST',arr)
			
			//first line contains exact where
			stackArr=[arr.shift()]; 
// console.log('BEFORE',arr)

			//Then comes the garbadge lines...
			while(true){
				let line=arr.shift();
				// console.log('DISCARDING',line);
				if(line==undefined || line.includes('ReferenceError:')){
					break;
				}

				//TODO 2019-12-09: Use a regex to grab all '  at' lines instead...
			}
// console.log('REMAINING',arr)

			return stackArr.concat(arr);
		}
	}


	/*
	* These stacks normally look like this:
	*   Error: Cannot find module '/home/buck/Documents/Software/Q/apps/q-ffmpeg//home/buck/Documents/Software/Q/apps/q-ffmpeg/ffmpeg.pipe.js'
	*	Require stack:
	*	- /home/buck/Documents/Software/Q/qmaster/src/appsd.js
	*	    at Function.Module._resolveFilename (internal/modules/cjs/loader.js:780:15)
	*	    at Function.Module._load (internal/modules/cjs/loader.js:685:27)
	*	    at Module.require (internal/modules/cjs/loader.js:838:19)
	*	    at require (internal/modules/cjs/helpers.js:74:18)
	*	    at tryRequire (/home/buck/Documents/Software/Q/qmaster/src/appsd.js:386:10)
	*	    at loadApp (/home/buck/Documents/Software/Q/qmaster/src/appsd.js:403:16)
	*	    at initApps (/home/buck/Documents/Software/Q/qmaster/src/appsd.js:356:19)
	* Yes, the stack actually includes the error too. In this case the first line we actually want is tryRequire()
	*
	* @param string
	* @return array
	*/
	function handleModuleNotFoundStack(str){
		var arr=splitStackString(str); //removes 1st line that contains the error
		arr.shift(); //remove the line that says 

		//The next line says Require stack:', then I'm guessing there may be several of the next row (those starting with -) 
		//because the error has a matching prop .requireStack:[]. Then follows a few internal lines that we also don't want. 
		//In fact the first line we one is the one AFTER that which contains...
		let l=arr.length,i=0;
		while(arr.length){
			let line=arr.shift();
			if(line.match(/^\s+at require \(/))
				break;
		}

		//As a backup, if we removed all the lines, make an educated guess that the first 7 lines have to go
		if(!arr.length)
			return splitStackString(str).slice(7); //start from line nr 8
		else 
			return arr;
	}

	/*
	* @param string lineStr		A line single line from the stack which contains calling function, file, line
	*
	* @return object{where:string, func:string}
	* @no_throw
	*/
	function parseStackLine(lineStr){
		// if(line.includes('smarties.js:1468'))
		// 	debugger;
		var obj={where:'unknown', func:'unknown',file:'unknown',line:0, pos:0,orig:lineStr};
		//DevNote: toPrintArray() will look for 'unknown' when determining if a certain prop is set or not
		try{
			if(!lineStr)
				throw 'Empty line'

			//Remove surrounding whitespace
			lineStr=lineStr.trim();

			var where;
			if(BetterLog._envDetails.browser=='firefox'){
				let i=lineStr.indexOf('@');
				obj.func=lineStr.substr(0,i)||obj.func;
				where=lineStr.substr(i+1);
			// }else if(BetterLog._env=='inspector' && lineStr.startsWith('at /')){
			}else if(lineStr.startsWith('at /')){
    	//Example line    'at /home/buck/git/q/qmaster/src/qmaster.js:151:11'
    			where=lineStr.substr(3);
    			
    			//To prevent toPrintArray() from printing lineStr (srg#1 ^) as the function we change .func
    			obj.func='<anonymous>'
			}else{
		//Example line    'at _SyntaxError_ (/path/to/q/common-lib/smarties/smarties.js:1468'
				var m=lineStr.match(/^(at\s+)?([^(]+)?\s*\(([^)]+)\)/); //17 steps
				if(m){
					obj.func=m[2].trim()||obj.func;
					where=m[3];
				}
			}

			if(where){
				let [pos,x,...file]=where.split(':').reverse();
				let lineNo=Number(x);
				if(isNaN(x)){
					file.unshift(x); //we know x is really the end of file...
					lineNo=Number(pos); //but we don't know if pos is the line or if there is no line...
					if(isNaN(lineNo)){
						file.unshift(pos);//turns out there was no line or pos
					}else{
						obj.line=lineNo; //turns out there was only a line
					}
				}else{
					obj.line=lineNo; //we know it's the line number...
					pos=Number(pos);//...but we don't know if there is also a pos
					if(!isNaN(pos))
						obj.pos=pos;
				}
				obj.file=file.reverse().join(':');
				obj.where=`${obj.file}:${obj.line}:${obj.pos}`

				//In 'inspector' (nodejs) the uri needs to be prepended by 'file://' to actually link to the file
				if(BetterLog._env=='inspector' && obj.file[0]=='/'){ 
					obj.where='file://'+obj.where; 
				}
			}

			//Check for a mark
			obj.mark=getMark(obj.func)

		}catch(err){
			obj.err=err;
		}

		return obj;
	}






	function splitStackString(stackStr){
		return stackStr.split(/\r\n|\r|\n/) //Turn into array (windows and unix compatible)
			.slice(1) //first row just says 'Error'
	}






	/*
	* Remove duplicate lines from a stack. 
	*
	* NOTE: this should be called when printing
	*
	* @param array[object] stackArr 	
	* @return array
	*/
	function removeDuplicateLines(stackArr){
		var last,count=1,output=[],i=0,len=stackArr.length;
		for(i; i<len;i++){
			if(last){
				if(last.orig){
					if(stackArr[i].orig==last.orig){
						//If this line is the same as the last, increase the count, then continue so we DON'T include this line in the output
						count++;
						continue;
					}
				}else if(stackArr[i].func==last.func && stackArr[i].where==last.where){
					count++;
					continue;
				}

				if(count>1){
					//Lines are not the same but we have a count, that means the last line was the last of a series of duplicates, so set 
					//a count on it, then reset the count
					last.repeat=count;				
					count=1;
				}
			}
			//Prepare for next loop by storing the current item as last AND appending it to the output...
			last=stackArr[i];
			output.push(last);
		}
		//After the loop we may still have a count because the builtin stack wasn't long enoug... 
		if(count>1)
			last.repeat=count

		return output;
	}










































	/*
	* Create a BetterLogEntry or BetterLogError. This should be the only method that calls new on said constructors
	*
	* @return <BetterLogEntry>|<BetterLogError>
	*/
	BetterLog.prototype.makeEntryRaw=function(lvl,msg,extra,stack){
		if(getLvlNr(lvl)>5){
			return new BetterLogError(this,lvl,msg,extra,stack)
		}else{
			return new BetterLogEntry(this,lvl,msg,extra,stack);
		}
	}





	/*
	* @param string lvl 		A string describing the level at which to log
	* @param mixed message 		The main logging content
	* @param array extra 		As many additional variables as you like
	* @param object log 		The log this entry belongs to, so we can find the log via the entry...
	*
	* @prop number id
	* @prop number|string code 	Try to use these where possible: 
	*				https://www-numi.fnal.gov/offline_software/srt_public_context/WebDocs/Errors/unix_system_errors.html
	* @prop number lvl
	* @prop string msg
	* @prop extra array
	* @prop <BLE>|null bubble
	* @prop number timestamp
	* @prop <BetterLog> log 	Defaults to syslog
	* @prop boolean printed
	* @prop array handling 		Think of these as 'notes' or 'steps' performed before the current entry was reached
	*
	* 
	* @return object 			The log entry
	* @access private
	*/
	function BetterLogEntry(log,lvl,msg,extra,stack){
		this.id=null; //set by this.exec() which adds it to a log
		this.updateTimestamp();
		Object.defineProperties(this,{ //set by reject() or throw();
			'_logs':{value:[(isBetterLog(log) ? log : BetterLog._syslog)]} //gets appended by .exec()
			,'log':{enumerable:true,get:()=>this._logs[this._logs.length-1]} //the original log where the entry was first created
			,'_currlog':{get:()=>this._logs[0],set:l=>{if(l&&l._isBetterLog){this._logs.unshift(l)}}} //the current log, set by exec()
			,'source':{enumerable:true, get:()=>this._options.source || this._options.name ||this.log.name} //printed before func

			,'_code':{configurable:true,writable:true,value:null}
			,'code':{enumerable:true,get:()=>this.getCode()||lvlLookup[this.lvl].Str,set:this.setCode.bind(this)}
			 //NOTE: code^ will always return a string, _code won't (local value) and getCode() will traverse bubbles looking for _code

			,'_options':{value:{}}
			,'options':{enumerable:true,get:()=>Object.assign({},this._currlog.options,this._options),set:this.setOptions.bind(this)}
			  //NOTE: these^ options change when this.log changes...

			,'_rocks':{value:[]} //inverted bubbles, so we can track...
			,'_firstBubble':{get:()=>{var entry=this;while(entry.bubble){entry=entry.bubble}return entry}}
			,'_age':{get:()=>Date.now()-this.timestamp}

			,'_rawStack':{writable:true} //string - set by this.setStack(), no processing
			,'_parsedStack':{writable:true} //undef|array - set by this.stackArr getter on first call
			,'stackArr':{enumerable:true, get:()=>{return this._parsedStack||(this._parsedStack=this._currlog.getStackArray(this._rawStack))}}
			  //^Remember: since it's parsed only once, options from currlog at the time are used...

		//2020-10-30: Only in BetterLogError
			// ,'stack':{get:()=>`${this.code}: ${this.message}\n ${this.stackArr.map(obj=>`    at ${obj.func} (${obj.where})`).join('\n')}`}
			  //^DevNote: has to be string for <Error> compatibility, else we sometimes get 'TypeError: stack.startsWith is not a function'
			  //^DevNote: this also has the effect in Node.js that console.log(<ble>) will print first this^ then the <ble> object...

			,'where':{enumerable:true, get:()=>this.stackArr[0].where||this.stackArr[0].orig||'<unknown whereabouts>'}
			,'func':{enumerable:true, get:()=>this.stackArr[0].func||'<unknown function>'}

			,'_stackMarks':{writable:true} //note: not the same as this.marks

			,'msg':{get:()=>this.message,set:msg=>this.message=msg} //for backwards compatability
		})

		//If NOT called from BetterLogError...
		if(!this.isBLE)
			Object.defineProperty(this,'isBLE',{value:'entry'})



		//In browser, so we can easily print BLEs that are logged to console, add a getter that activates print
		if(BetterLog._env=='browser')
			Object.defineProperty(this,'_print',{get:()=>this.print()})

		this.lvl=getLvlNr(lvl,4); //Can be changed later manually before printing...
		this.message=msg; 
		this.extra=(Array.isArray(extra)?extra:(extra!=undefined?[extra]:[]));
		
		this.handling=[]; //call this.addHandling() will append this list. NOT for bubbling up.
		this.printed=false;
		this.marks=[]; //these are manually set marks



		//If an error was passed in as main message...
		if(msg instanceof Error){
			this.message=msg.message;

			if(msg instanceof SyntaxError){
				this.extra.unshift(handleSyntaxErrorStack(msg.stack).description);
			}else if(msg instanceof TypeError && this.message.startsWith('Converting circular structure to JSON')){
				let description=this.message.substring(this.message.indexOf("\n")).replaceAll("|",'-')+"\n";
				this.extra.unshift(description);
				this.message="Cannot convert circular structure to JSON string";
				msg.name="EINVAL" // get's set vv
			}
				
			if(msg.code)
				this.setCode(msg.code);
			else if(msg.name!='Error')
				this.setCode(msg.name);
			  //DevNote: Remember: this.code getter will still default to returning 'Error' UNLESS it finds a bubbled entry with another code

			stack=msg.stack; //same handling as passed in stack vv 

		}else if(isJsonBLE(msg)){
			this.message=msg.message;

			//Before setting 'extra' vv, if any more were passed in here ^, reset print...
			this.printed=this.extra.length?false:msg.printed

			this.extra=msg.extra.concat(msg.bubble,extra); //the bubble will be moved out of extra vv, ie. same handling as everything else

			this.setCode(msg.code);
			this.timestamp=msg.timestamp;
			this.handling=msg.handling;
			this.marks=msg.marks;

			stack=msg.stack; //same handling as passed in stack vv 
		}


		this.bubble=null;
		var i;
		for(i=0;i<this.extra.length;i++){
			let x=this.extra[i]; 
			if(typeof x=='object'){
				if(setBubble.call(this,x)){
				 //^sets the bubble if x is an error or BLE, returning true in that case
					this.extra.splice(i,1);
					break;
				}
			}
		}


		if(typeof this.message=='string' && this.message.startsWith('Maximum call stack size')){
			stack=stack.split('\n').slice(0,10).join('\n');
		}
		this.setStack(stack);//sets this._rawStack

	}//end of BetterLogEntry. 
	//See also BetterLogError which has the same prototype but inherits from Error
	
	function isLiveBLE(x){
		if(x && typeof x=='object' && x.isBLE && x.isBLE!='json'){
			return true;
		}else{
			return false;
		} 
	}


	function isJsonBLE(obj){
		return (obj && typeof obj=='object' && obj.isBLE=='json');
	}
	BetterLog.isJsonBLE=isJsonBLE;

	/*
	* Only certain things are suitable to turn into json string, get there here
	*
	* @return object
	*/
	BetterLogEntry.prototype.toJSON=function(){
		var obj={
			source:this.source
			,id:this.id
			,code:this._code //the code explicitly set on this entry, unlike .code which defaults to lvlStr or bubbled code
			,lvl:this.lvl
			,message:this.message
			,extra:this.extra
			,timestamp:this.timestamp
			,printed:this.printed
			,handling:this.handling
			,stack:this.stack //This is the stack string (for Error compat), parse into new BLE access stackArr, _stackMarks, func, where etc
			,marks:this.marks
			,bubble:this.bubble?this.bubble.toJSON():null //this will work recursively
			,isBLE:'json'
		}

		//Add any custom props set directly on the entry
		for(let key of getCustomPropsOnEntry(this)){
			if(!obj.hasOwnProperty(key))
				obj[key]=this[key];
		}
		// console.log('BLE json str:',JSON.stringify(obj));
		return obj;
	}

	var defaultBLEProps;
	function getCustomPropsOnEntry(entry){
    	if(!defaultBLEProps){
    		let d=BetterLog._syslog.makeEntry('test');
    		defaultBLEProps=Object.getOwnPropertyNames(d).filter(prop=>d.propertyIsEnumerable(prop));
    	}
    	return Object.getOwnPropertyNames(entry).filter(prop=>!defaultBLEProps.includes(prop)&&entry.propertyIsEnumerable(prop))
	}



	/*
	* Set the "bubble" of this entry, ie. the previous error that bubbled up, was caught, and gave rise to this one
	*
	* @param any err    Passed to makeError()
	*
	* @return this
	* @public
	*/
	BetterLogEntry.prototype.setBubble=function(err){
		setBubble.call(this,this.log.makeError(err));
		return this;
	}
	/*
	* @return null|false|true 	null=>already set, false=>not an error, true=>err was set as the bubble
	* @private
	* @call(<BLE>)
	*/
	function setBubble(err){
		if(this.bubble){
			BetterLog._syslog.makeEntry("warn","Trying to set a second bubble on an entry.")
				.addHandling("entry:",this)
				.addHandling("new bubble:",err)
				.exec()
			;
			return null;
		}
		if(isLiveBLE(err)) {
		  //^we have to check for BLE before Error, since BLE is an error... that's why we have a little duplication
		  //of code vv
			this.bubble=err
			// this.code=this.bubble.code; //code bubbles up as well //2019-11-05: see vv
		}else if(err instanceof Error || isJsonBLE(err)){
			this.bubble=this.log.makeEntryRaw(err.lvl||6, err);
			// this.code=this.bubble.code; //2019-11-05: Doesn't make sense to bubble, we can still get it with getCode()
		}else{
			return false;
		}

		//Ad this entry to the bubble's rocks... 
		this.bubble._rocks.push(this); 			
		return true;
	}


	/*
	* Attempt to match the json version of this entry
	*
	* @param string|<RegExp> strOrRegexp
	*
	* @return array|null
	*/
	BetterLogEntry.prototype.match=function(strOrRegexp){
		return JSON.stringify(this).match(strOrRegexp);
	}

	/*
	* Check if a string or regexp matches any log name which this entry, or stack or one of it's bubbles, has been exec'ed on
	*
	* @param string|<RegExp> searchTerm
	*
	* @return boolean
	*/
	BetterLogEntry.prototype.matchLogName=function(searchTerm){
		var entry=this;
		try{
			while(entry){
				if(entry._logs.some(log=>log.name.match(searchTerm))){
					return true;
				}
				entry=entry.bubble;
			}
		}catch(err){
			console.error("Failed while checking BLE entry for affilitate log names:",searchTerm,entry,err);
		}
		return false;
	}

	/*
	* @return string 	The	code+message+extras of this entry (no where,bubble or handling), all on a single line 
	*/
	BetterLogEntry.prototype.toString=function(){
		//Start by turning any extras into strings
		let extra=this.extra.map(x=>logVar(x,300,'noType'))
		//Then use the same mechanism as when printing...
		return addInfo([],null,this._code,this.message,null,extra,this.options)
			.join(' ')
			.replace('"\n"',' ').replace('\n',' ')
		;
	}


	/*
	* Store this entry on a hidden prop on an object. 
	*
	* @opt object obj                Best effort, if no object is passed then nothing is stored anywhere
	* @opt boolean dontStoreIfFalse  If ===false then nothing will be stored
	*
	* @return this
	*/
	BetterLogEntry.prototype.storeOnObject=function(obj,dontStoreIfFalse){
		if(dontStoreIfFalse!==false && obj && typeof obj=='object'){
			
			//Create an array to hold this and future entries...
			if(!obj.hasOwnProperty('_BetterLogEntries')){
				let entries=[];
				Object.defineProperty(entries,'dump',{value:(options,noVerbose=true)=>this._currlog.dump(options,entries.slice(0).reverse(),noVerbose)});
				Object.defineProperty(obj,'_BetterLogEntries',{configurable:true, value:entries});
				//For nodes add an easy way to dump by clicking
				if(varType(obj)=='node'){
					Object.defineProperty(obj,'aa_DumpBetterLogEntries',{enumerable:true,get:entries.dump,configurable:true}); 
					  //The aa^ puts it at the top of the property list in devtools
				}
			}
			// Check that the last item in the list isn't this
			if(obj._BetterLogEntries[0]!=this)
				obj._BetterLogEntries.unshift(this);
		}
		return this;
	}




	/*
	* Get the bubbel furthest away from this entry
	*
	* @return <ble> 	Either this entry, or a previous one 	
	*/
	BetterLogEntry.prototype.getFirstBubble=function(){
		var self=this
		while(self.bubble){
			self=self.bubble
		}
		return self;
	}





	/*
	* The first code of this or any bubbled entry
	*
	* NOTE: This accesses this._code, which is different from this.code; the latter will always return something, defaulting
	*       to the lvl string
	*
	* @return string|number|null 	
	*/
	BetterLogEntry.prototype.getCode=function(){
		return this._code||(this.bubble?this.bubble.getCode():null)
	}


	/*
	* Set the code of this entry. Optionally only set it if none was set on bubbled err
	* @param string|number lvl
	* @return this
	*/
	BetterLogEntry.prototype.setCode=function(code=null,onlyBackup=false){
		if(!onlyBackup || !this.getCode()){ //if the code isn't a backup, or if no code can be found on bubbles...
			//...then we're going to set the code now
			if(typeof code=='string' || typeof code=='number'){
				this._code=code;
			}else{
				console.warn("BetterLogEntry.code can only be string or number, got:",logVar(code));
			}
		}
		return this;
	}



	/*
	* Assign options for this entry. 
	* @param object options 
	* @return this
	*/
	BetterLogEntry.prototype.setOptions=function(options){
		if(options && typeof options=='object'){
			Object.assign(this._options,options);
		}else{
			console.warn(new TypeError("Cannot set options on BetterLogEntry. Expected object."),options);
		}
		return this;
	}

	/*
	* Add color options to entry, and set it to always be automatically printed
	*
	* @return this
	*/
	BetterLogEntry.prototype.highlight=function(color){
		if(typeof color=='string')
			color=color.replace('light','').replace('background','').trim()

		var colors;
		if(highlightColor.hasOwnProperty(color)){
			colors=highlightColor[color];
		}else{
			color=logLvl[this.lvl].colorTerm.replace('light','').replace('background','').trim();
			colors=highlightColor[color];
		}
			
		let options=Object.assign({autoPrintLvl:1},colors);

		this.setOptions(options);

		return this;
	}


	/*
	* Set (or change) the stack for this entry.
    *
	* NOTE: this doesn't process anything when called, just saves a stack to this._rawStack 
	* NOTE: if a stackArray or a BLE is passed it will be ignored and a new stack created
	*
	* @param <Error>|string errOrStack 	@see getStackStr 
	*
	* @return this
	*/
	BetterLogEntry.prototype.setStack=function(errOrStack){
		this._rawStack=getStackStr(errOrStack);
		this._parsedStack=undefined;
		this._stackMarks=undefined;
		return this;
	}

	/*
	* Append a stack to the currently set stack. This can be good when working with async functions who normally only have a 
	* stack of 2 items, eg:
	*  [Stack] 
    *  | foobar (index.js:371:9) 
    *  | processTicksAndRejections (task_queues.js:93:5)
	*
	* @param <Error>|string|array errOrStack 	@see getStackArray
	*
	* @return this
	*/
	BetterLogEntry.prototype.appendStack=function(extraStack){
		
		//Get the string
		var str=getStackStr(extraStack);

		//Remove first line with error message
		str=str.substring(str.indexOf('\n')); 
		 //^this keeps the first newline, which we want vv (else it goes on same row as last of vv)

		//Then set, prepended by the current stack
		this.setStack(this._rawStack+str); //this will reset the _parsedStack and _stackMarks too

		return this;

	}
	

	/*
	* Slice off x rows in the begining of the stack. Also affects this.where and this.func (which are getters)
	*
	* @param number removeLines 	The number of lines to remove from the stack
	*
	* @return this
	*/
	BetterLogEntry.prototype.changeWhere=function(removeLines){
		//Simply remove lines from the stack... since .func and .where are getters they don't need attention
		this.stackArr.splice(0,removeLines); 

		this._stackMarks=undefined;

		return this;
	}

	/*
	* Append 'to ${stack[1]}' to this entry
	* @return this
	*/
	BetterLogEntry.prototype.addTo=function(){
		return addPlace.call(this,'to');
	}
	
	/*
	* Append 'from ${stack[1]}' to this entry
	* @return this
	*/
	BetterLogEntry.prototype.addFrom=function(){
		return addPlace.call(this,'from');
	}
	
	/*
	* Add handling 'Called from ${stack[1]}' to this entry
	* @return this
	*/
	BetterLogEntry.prototype.calledFrom=function(){
		return addPlace.call(this,'called');

	}

	/*
	* Add handling 'Originated from ${stack[last]}' to this entry
	* @return this
	*/
	BetterLogEntry.prototype.addOrigin=function(){
		return addPlace.call(this,'origin');

	}

	/* Common function for ^ */
	function addPlace(mode){
		try{
			if(this.stackArr.length>1){
				//stack[0] should be the first func outside this file, so stack[1] will be the the func that
				//called that guy...
				let line=(mode=='origin' ? this.stackArr[this.stackArr.length-1] : this.stackArr[1]);
				var place=`${line.func||'unknown'} (${line.where||'unknown'})`;
			}else{
				console.warn("Why is stack so short? Cannot trace...",this);
				place='UNKNOWN';
			}
			switch(mode){
				case 'to':
				case 'from':
					this.append(' '+mode+' '+place); 
					break;
				case 'called':
					this.handling.push({what:'Called from '+place});
					break;
				case 'origin':
					this.handling.push({what:'Originated from '+place});
			}
		}catch(err){
			console.error("Not adding 'from' to BLE entry.",err);
		}
		return this;
	}

	/*
	* Check if a string or regexp matches this entry's stack or one of it's bubbles
	*
	* @param string|<RegExp> searchTerm
	*
	* @return boolean
	*/
	BetterLogEntry.prototype.matchStack=function(searchTerm){
		var entry=this;
		try{
			while(entry){
				if(entry._rawStack.match(searchTerm)){
					return true;
				}
				entry=entry.bubble;
			}
		}catch(err){
			console.error("Failed while checking BLE entry stack for search term:",searchTerm,entry,err);
		}
		return false;
	}





	/*
	* Get a combined unique lists of marks from the stack and manually set marks
	* @return array
	*/
	BetterLogEntry.prototype.getAllMarks=function(){
		if(!this._stackMarks){
			this._stackMarks=this.stackArr
				.filter(line=>line.mark)
				.map(line=>line.mark)
				.filter((mark,i,arr)=>arr.indexOf(mark)==i)
		}
		return this.marks.concat(this._stackMarks).filter((mark,i,arr)=>arr.indexOf(mark)==i);
	}


	/*
	* Check if this stack contains a specific mark
	* @param string|number mark
	* @return boolean
	*/
	BetterLogEntry.prototype.hasMark=function(mark){
		mark=unmakeMark(mark);
		for(let m of this.marks){
			if(m==mark)
				return true;
		}
		for(let line of this.stackArr){
			if(line.mark==mark)
				return true
		}
		return false;
	}
	
	/*
	* Ad a manual mark to this entry
	* @param string|number mark
	* @return this
	*/
	BetterLogEntry.prototype.setMark=function(mark){
		if(mark && !this.marks.includes(mark))
			this.marks.push(mark);
		return this;
	}

	/*
	* Change the log lvl of this entry. 
	* @param string|number lvl
	* @return this
	*/
	BetterLogEntry.prototype.changeLvl=BetterLogEntry.prototype.setLvl=function(lvl){
		this.lvl=getLvlNr(lvl);
		return this;
	}


	/*
	* Add handling information to entry
	*
	* @return this
	*/
	BetterLogEntry.prototype.addHandling=function(handling,...extra){
		try{
			//Get passed in stack or generate one here
			var stackArr=extra.find(x=>Array.isArray(x)&&x._isStackArr) 
				|| this._currlog.getStackArray((typeof handling=='object' && handling.stack) ? handling.stack:(new Error()).stack);

			this.handling.push({where:stackArr[0].where,what:handling,extra:extra}); 
		}catch(err){
			console.error('Not adding handling to entry.',err);
		}
		return this;
	}



	BetterLogEntry.prototype.prepend=function(pre){
		if(typeof pre!='string')
			return this;

		if(typeof this.message=='string'){
			//Make sure msg doesn't already contain the same string
			if(this.message.toLowerCase().replace(/[.:,;]/g,'').includes(pre.toLowerCase().replace(/[.:,;]/g,'')))
				return this;

			//Make sure it ends in a whitespace
			if(!pre[pre.length-1].match(/\s/))
				pre+=' '

			this.message=pre+this.message
		}else{
			this.extra.unshift(this.message);
			this.message=pre;
		}
		return this;
	}


	/*
	* Add a string to as the last thing to be printed on the first line. It will be appended to the message if no 
	* extras are strings, else it'll get inserted into the extra array at the right point
	*
	* @param string end
	*
	* @return this
	*/
	BetterLogEntry.prototype.append=function(end){
		if(typeof end!='string')
			return this;

		if(typeof this.message=='string' && (!this.extra.length || typeof this.extra[0]!='string')){
			this.message+=end;
		}else{
			var addToEnd=true, i=0,l=this.extra.length;
			for(i; i<l;i++){
				if(typeof this.extra[i]!='string'){
					this.extra.splice(i,end);
					addToEnd=false;
				}else if(this.extra[i].match(/\/n/)){
					let arr=this.extra[i].split('/n');
					arr.splice(1,end);
					this.extra[i]=arr.join('/n');
				}
			}
			if(addToEnd)
				this.extra.push(end);
		}
		return this;
	}

	/*
	* Make sure something exists somewhere in the entry or one of it's bubbles, else add it as an extra
	*
	* NOTE: strings and numbers count as existing if they're a substring of something else
	*
	* @param any x
	*
	* @return this
	*/
	BetterLogEntry.prototype.somewhere=function(x){
		//Define a checker function...
		if(typeof x=='string')
			var check=(y)=>typeof y=='string' && y.includes(x);
		else if(typeof x=='number')
			check=(y)=>(typeof y=='string'&&y.includes(x))||(typeof y=='number' && x===y);
		else
			check=(y)=>x===y
		

		//Check along the entire bubble chain...
		try{
			var self=this;
			while(self){

				//Does the message contain it?
				if(check(self.message))
					return this;

				//Is it one of the extras??
				if(self.extra.find(check))
					return this;

				if(self.marks.find(check)||(self._stackMarks && self._stackMarks.find(check)))
					return this;

				self=self.bubble;
			}
		}catch(err){
			console.error(err,self);
		}

		//If we're still running, add it!
		return this.addExtra(x);

	}


	/*
	* Add one or more items to the .extra array.
	*
	* NOTE: this won't add any 'undefined'
	*
	* @params any ...items
	*
	* @return this
	*/
	BetterLogEntry.prototype.addExtra=function(...items){
		this.extra.push.apply(this.extra,items);
		return this;
	}



	/*
	* Add a code snippet to the entry and highlight characters around a given position
	*
	* @param string snippet 	
	* @param number strpos 		The starting position to highlight
	* @opt number count 		Default 1. The number of characters to highlight
	*
	* @return this
	*/
	BetterLogEntry.prototype.highlightBadCode=function(snippet,start,count=1){
		if(BetterLog._env=='terminal' && this.options.printColor){
			snippet=wrapSubstrInBashColor(snippet,start,start+count,101);
		}else{
			snippet=snippet.substr(0,start)+'>>>'+snippet.substr(start,count)+'<<<'+snippet.substr(start+count);
		}

		//Focus in on the highlighted area if needed (ie. so it doesn't get cut when printing)
		if(snippet.length>this.options.extraLength){
			//NOTE: we're using the options set on the entry, which means passing another extraLength when printing can't
			//      make this string longer again
			let half=this.options.extraLength/2
			if((start+half)>snippet.length)
				snippet='...'+snippet.substr(snippet.length-(half*2)); //no dots at end
			if(half>start)
				snippet='...'+snippet.substr(start-half,half*2)+'...'; //snippet in the middle, dots on both sides
			else
				snippet=snippet.substr(0,half*2)+'...'; //no dots at begining
		}

		return this.addExtra(snippet);
	}



	/*
	* Update the timestamp to show right now
	* @return this;
	*/
	BetterLogEntry.prototype.updateTimestamp=function(){
		this.timestamp=Date.now();
		return this;
	}


	/*
	* Handle an entry, ie. add it to the current of another log, emit it, print it
	*
	* NOTE: An entry can be emitted and appended multiple times, but won't be printed multiple times. To force a re-print
	*		then use this.print() instead
	*
	* @opt <BetterLog>  If passed the entry will be appended to this log instead of its current this.log
	* @flag 'force' 	If passed the entry will be handled regardless of level
	*
	* @return this
	*/
	BetterLogEntry.prototype.exec=function(asLog){

		//If another log was passed change the entry's current log
		if(asLog && asLog._isBetterLog){
			this._currlog=asLog; //appends to this._logs
		}

		//Check that we're not ignoring this lvl...
		if(this._currlog.options.lowestLvl<=this.lvl || Array(arguments).includes('force')){

			//Add it to our entries array and use the index as id (this id can be changed up until the point it's printed)
			try{this.id=this._currlog.entries.push(this)-1}catch{};

			//Emit. This will call any listeners added in reverse order (ie. latest added get's called first). Appending the syslog
			//or another log is accomplished by virtue of listeners added by our constructor^
			this._currlog.emit(this); 
				//2020-08-24: changed. before we emitted on syslog here, now emitting is a listener on this log... which may have
				//            an effect of how stacks/where is handled... maybe....

			//Possible auto-printing happens AFTER the entry has been emitted. If it's printed there it won't be printed 
			//again... This works because .emit() is NOT async, ie. all callbacks happen in sequence
			if(this.printed==false && this.options.autoPrintLvl && this.lvl>=this.options.autoPrintLvl)
				this.print();

			if(this.lvl==6 && this.options.breakOnError)
				debugger;
		}
	

		return this;
	}

	
	



	/*
	* Wrap entry in rejected promise
	*
	* @return Promise.reject(this)
	*/
	BetterLogEntry.prototype.reject=function(code,onlyBackup){
		code && this.setCode(code,onlyBackup);
		var rej=Promise.reject(this);
		// console.error("ble.reject() called, going to return:",rej);
		return rej;
	}

	/*
	* Throw the entry
	*
	* @throws BLE
	* @return n/a
	*/
	BetterLogEntry.prototype.throw=function(code,onlyBackup){
		if(code) this.setCode(code,onlyBackup);
		throw this;
	}








	/*
	* Print the entry (even if it's been previously printed or is under any autoPrintLvl etc).
	*
	* NOTE: This method prints the entry even if it's been previously printed
	* NOTE2: This method group-prints all bubbles that have not yet been printed, while referencing those that have
	*
	* @opt object oneTimeOptions     Options that will superseede anything set on this entry or it's current log
	*
	* @return this
	*/
	BetterLogEntry.prototype.print=function(oneTimeOptions){
		try{

			//The id can no longer be changed since it's been comitted to print
			if(typeof this.id=='number')
				Object.defineProperty(this,'id',{writable:false});

			//First we combine the options
			options=Object.assign({},lvlLookup[this.lvl],this.options,oneTimeOptions);

			//Then loop through any bubbled entries and get their output...
			var bubbles=[], entry=this;
			while(entry.bubble){
				entry=entry.bubble;
				let arr;
				if(entry.printed && !options.reprintBubbles){
					let prev=entry.toString();
					prev=prev.length>60?prev.substring(0,60)+'...':prev;
					if(entry.options.printId)
						prev="#"+entry.id+": "+prev;
					arr=[prev];
					addWhere(entry.where,options,arr);
					arr.print=lvlLookup[entry.lvl].print;

					//DevNote: We don't break the loop here because it's good to get a quick summary of all the bubbled errors instead
					//         of just getting the last one and then having to scroll up...
				}else{
					//We use the same options as above EXCEPT any explicit options set on the entry...
			//2022-03-09: we want the bubbles to print with whatever level they had
					// let _options=Object.keys(entry._options).length?Object.assign({},options,entry._options):options;
					let _options=Object.assign({},options,lvlLookup[entry.lvl],entry._options);

					arr=toPrintArray.call(entry,_options);
					entry.printed=true;                                       //<--- this and vv is were entries as marked 'printed'
					 //^DevNote: we set printed here since we dont have access to the live entry vv
				}

				bubbles.push(arr);
			}
			//...and if any exists then group them and print the oldest one first
			if(bubbles.length){
				console.group(`--- ${options.STR||lvlLookup[this.lvl].STR} #${this.id} ---`);
				let indent=(BetterLog._env=='terminal' ? [] : [' ']); //terminal indents on it's own. don't pass ANY arg if terminal
				//First indent all the way out...
				for(let i=bubbles.length-1; i>=0;i--){
					console.group.apply(this,indent);
				}
				//...then print, un-indent, print...
				for(let i=bubbles.length-1; i>=0;i--){
					bubbles[i].print.apply(null,bubbles[i]);
					console.groupEnd();
				}
			}

			//Now print the current entry
			this.printed=true;                                                  //<--- this and ^^ is were entries as marked 'printed'
			var arr=toPrintArray.call(this,options);
			arr.print.apply(null,arr);

			//If we had a group before, print a closing line
			if(bubbles.length){
				console.groupEnd();
				if(BetterLog._env=='terminal')
					console.log('--- end ---');
			}
		}catch(err){
			console.group("BUGBUG - BetterLogEntry.print() failed:")
			console.error(err);
			console.groupEnd();
		}

		return this;
	}




	/*
	* @param object options     @see BLE.print(). Level options + entry options + one time options
	*
	* @return array[string] 	Array of all the lines of the entry
	* @call(ble)
	*/
	function toPrintArray(options){
	
		try{
			//Create the array to hold all the pieces we'll print
			var arr=[];

			//Start filling the array
			if(options.printId){
				arr.push('#'+String(this.id),'-');
			}

			if(options.printMs){
				arr.push(String(this.timestamp-startTime),'-');
			}else if(options.printTime){
				var ts=((typeof options.printTime) == 'function' ? options.printTime(this.timestamp) : this.timestamp);
				arr.push(ts,'-');				
			}

			//Turn into array since we're about to get fancy with it
			if(BetterLog._env!='terminal' && options.printColor)
				options.colorBrow=[options.colorBrow];

			if(options.printMarks){
				let marks=this.getAllMarks()
					.filter(mark=>typeof mark=='string'&&!mark.startsWith('_intercept')) //don't print intercept marks... they're used for something else
					.map(mark=>`[${mark}]`)
					.join(' ')
				;
				if(marks){
					if(options.printColor){
						if(BetterLog._env=='terminal')
							marks=wrapInBashColor(marks,'pink');
						else{
							//NOTE: this works together with the block below, where colorBrow is used 
							marks='%c'+marks+'%c'; 
							options.colorBrow.unshift('color:pink','color:initial')
						}
					}
					arr.push(marks);					
				}
			}

			//Get the source of the entry, which is based on the name of the original "source" log. This will go between brackets at the start 
			//of the printed line
			{
				//NOTE: we ignore options passed to the current log, instead we check:
				let source=options.source || this.source;

				if(source){
					//Ok so we have a source, perhaps we want to append the func...
					if(options.printFunc && this.func){ 
						//...and in that case let's remove dublicates and stuff of no informational value

						let func=this.func
							.replace(source,'') //if source already contains func...
							.replace(/Object\.<anonymous>/,''); //no info

						//Remove the "unit string" from the func since the name is what we're using (if unit is Foo{}, then 
						//the name will either be "Foo" (set by constructor) or "Bar" (option), and we don't want
						//"Foo.Foo" or "Foo.Bar", we just want "Foo" or "Bar"
						if(typeof this.log.unit=='object') 
							func=func.replace(this.log.unit.constructor.name,'')
						
						//If there's anything of the func left, append it!
						if(func)
							source=(source+'.'+func).replace('..','.');
					}
				
				}else if(options.printFunc){ 
					source=this.func+'()';
				}else{
					source=this.where;
				}


				if(options.sourcePrefix)
					source=options.sourcePrefix+source
				
				if(source){
					source='['+source+']';
					if(options.printColor){
						if(BetterLog._env=='terminal')
							source=wrapInBashColor(source,'yellow');
						else{
							//NOTE: this works together with the block below, where colorBrow is used 
							source='%c'+source+'%c'; 
							options.colorBrow.splice(-1,0,'font-weight:bold','font-weight:initial')
						}
					}
					arr.push(source,'-');
				}
			}
			
			//log lvl string
			if(options.printColor){
				if(BetterLog._env=='terminal'){
						arr.push(wrapInBashColor(options.STR,options.colorTerm));
				}else{
					if(options.colorBrow){ //in browsers, warn and error are already colored, so colorBrow=null at top ^^
						
						//NOTE: The console.log in browsers has a requirement - only the first string can 
						//be colorized, so we combine anything already in arr and add the level
						arr=[arr.join(' ')+` %c ${options.STR} `].concat(options.colorBrow);
					}else{
						arr.push(options.STR);
					}
				}
			}else{
				arr.push(options.STR); 
			}
			arr.push('-')


			//Main msg
			addInfo(arr,'',this._code,this.message,this.where,this.extra,options,3);		

			//Stack
			if(options.printStackLvl && this.lvl>=options.printStackLvl){
				oneNewline(arr)
				let indent=' '.repeat(3);
				let max=options.printStackLines||100;
				let stack=(this.stackArr.length>max ? removeDuplicateLines(this.stackArr) : this.stackArr)
				if(stack.length){
					arr.push(`${indent}[Stack]`)
					for(let line of stack){
						let func=(line.func=='unknown' ? line.orig : line.func); 
						let where=(line.func=='unknown' && line.where=='unknown' ? '':` (${line.where})`);
						let repeat=(line.repeat?` [${line.repeat} times]`:'');
						arr.push(`\n${indent} | ${func}${where}${repeat}`)
					}
					// arr.push.apply(arr,stack.map(line=>{
					// 	let func=(line.func=='unknown' ? line.orig : line.func); 
					// 	let where=(line.func=='unknown' && line.where=='unknown' ? '':` (${line.where})`);
					// 	let repeat=(line.repeat?` [${line.repeat} times]`:'');
					// 	return `\n${indent} | ${func}${where}${repeat}`
					// }));
				}
			}

			//Handling 
			if(this.handling){
				let pre=' -->';
				if(options.printColor && BetterLog._env=='terminal'){
					pre=wrapInBashColor(pre, 'light blue','bold');
				}
				
				 //in browser you can only color first string, so we only do in terminal here
				for(let {what,where,extra} of this.handling){
					oneNewline(arr) 
					addInfo(arr,pre,null,what,where,extra,options,pre.length+2)
				}
				// this.handling.forEach(({what,where,extra})=>{
				// })
			}


			
			//If opted, in browser, add log so we can easily check previous messages
			if(options.printSelfOnLvl && options.printSelfOnLvl<=this.lvl && BetterLog._env!='terminal'){
				oneNewline(arr)
				arr.push(this);
			}

			
			//In Chromiums console, if the first item in arr is a number, all the string items get quoted,
			//so just to make it look pretty, make sure the first item is a string
			arr[0]=String(arr[0]);


			

		}catch(err){
			console.group("BUGBUG - BetterLogEntry.toPrintArray() failed:")
			console.error(err);
			console.groupEnd();
		}


		//Finally add a print method to the array and return it
		let printMethod=options.printMethod||this.lvl;
		switch(typeof printMethod){
			case 'function': 
				break;
			case 'object': 
				printMethod=printMethod[this.lvl]; 
				break;
			case 'string': 
			case 'number': 
				printMethod=lvlLookup[printMethod].print
		}
		printMethod=(typeof printMethod=='function'?printMethod:lvlLookup[this.lvl].print);
		Object.defineProperty(arr,'print',{value:printMethod});
		return arr;

	}

	

	/*
	* Wrap string in bash color codes
	* @return string
	*/
	function wrapInBashColor(str,...colors){
		return colors.map(getBashColorCode).join('')+str+getBashColorCode('reset')//+getBashColorCode('red background');
		  //2020-10-23: the issue with background color coloring the rest of the row can't be reset or overwritten...
	}


	/*
	* Wrap substring in bash color codes
	* @return string
	*/
	function wrapSubstrInBashColor(str,start,stop,...colors){
		return str.substr(0,start)+wrapInBashColor(str.substr(start,stop-start),...colors)+str.substr(stop);
	}


	/*
	* Make sure the log array doesn't have duplicate newlines so we get a bunch of empty rows when printing
	* @return void;
	*/
	function oneNewline(arr,indent=0){
		let l=arr.length-1;
		let last=arr[l];
		indent=typeof indent=='string' ? indent : (' ').repeat(indent); //turn into string

		if(typeof last!='string'){
			arr.push('\n'+indent);
		}

		//Add just indentation if that's missing
		else if(indent && last.match(/\n$/)){
			arr[l]+=indent;
			
		}

		//Add newline and indent... 
		else if(!last.match(/\n$/)) {
			arr.push('\n'+indent);
		}
		
		//...we're not dealing with all scenarios, so this may obviously cause bugs...

		return;
	}





	/*
	* Dynamic method to add item to print array. In terminal everything will be converted to printable strings, while in 
	* browser we want to print live objects as the devtools allow us to explore them
	*
	* @param array printArray 	NOTE: this array get's appended
	* @param mixed item
	* @opt number len 			The length strings should be limited to. Default 0 => don't limit
	*
	* @return void
	*/
	var pushItem={
		browser:function(printArray,item,len=0){printArray.push(typeof item=='string' ? ((len>0&&item.length>len)?item.substr(0,len)+'...':item): item);}
		,terminal:function(printArray,item,len=0){printArray.push(typeof item=='string' ? ((len>0&&item.length>len)?item.substr(0,len)+'...':item): logVar(item,len));}
	}
	pushItem['inspector']=pushItem['browser'];


	/*
	* Add msg/extra/handling/bubble to the array
	*
	* @return $arr 		The same array that was passed in
	*/
	function addInfo(arr,pre,code,msg,where,extra,options,extraIndent){
		var push=pushItem[BetterLog._env].bind(this,arr);

		//First we combine pre and code
		pre=String(pre||'')
		if(code||code===0)
			pre+=String(code)+': '

		if(typeof msg=='string')
			push(pre+msg,options.msgLength+pre.length);	
		else if(pre){
			push(pre);
			push(msg,options.msgLength);
		}else
			push(msg,options.msgLength);

		//As long as all we're logging is primitives they can go on the same row, otherwise we want each on it's own row.
		var useNewline=false;
		if(typeof msg=='object'){
			addWhere(where,options,arr);
			useNewline=true;
			oneNewline(arr);
		}
		if(extra){
			(Array.isArray(extra) ? extra : [extra]).forEach((xtra,i)=>{
				if(xtra && xtra.isBLE){ //this shouldn't really happen since other entries should be bubbles... so just turn it into a string
					xtra=xtra.toString();
				}
				if(
					useNewline 
					|| (typeof xtra=='string' && xtra.match(/\n/))
					|| (typeof xtra=='object' && (i>0 || !(xtra instanceof Error) ) )
				){
					if(!useNewline) //on the first newline, also add the where
						addWhere(where,options,arr);
					oneNewline(arr,extraIndent);
					// arr.push(xtra); 
					push(xtra,options.extraLength);
					useNewline=true;
				}else{
					// arr.push(xtra); 
					push(xtra,options.extraLength);
				}
			})		
		}

		//If we still havn't added the where, do it now before handling vv
		if(!useNewline){
			addWhere(where,options,arr);
		}

		return arr;
	}


	/*
	* Append "where" from the stack to a string. NOTE: alters passed in array
	*
	* @param object options
	* @param string where
	* @param array arr
	*
	* @return void
	*/
	function addWhere(where,options,arr){
		if(where==null || !options.printWhere)
			return;

		where='@ '+where.trim(); //+'\n' //+'aaa'
		//2020-10-23: the issue with background color coloring the rest of the row can't be fixed by trimming or appending

		if(options.printColor && BetterLog._env=='terminal'){ //add color if opted and we're in bash
			where=wrapInBashColor(where, 'yellow','gray background');
		}

		arr.push(where);
	}






	function BetterLogError(){
		Object.defineProperties(this,{
			'name':{get:()=>this.code}
			,'stack':{get:()=>`${this.code}: ${this.message}\n${this.stackArr.map(obj=>`    at ${obj.func} (${obj.where})`).join('\n')}`}
			  //^DevNote: has to be string for <Error> compatibility, else we can get 'TypeError: stack.startsWith is not a function'
			  //^DevNote: this also has the effect in Node.js that console.log(<ble>) will print first this^ then the <ble> object...
			,'isBLE':{value:'error'}
		})
		BetterLogEntry.apply(this,arguments);
	}
	BetterLogError.prototype=Object.create(Error.prototype); 
	Object.assign(BetterLogError.prototype,BetterLogEntry.prototype);
	Object.defineProperty(BetterLogError.prototype, 'constructor', {value: BetterLogError}); 








	//Setup first log, the syslog!
	BetterLog._syslog=new BetterLog('_syslog',{appendSyslog:false});
	BetterLog._syslog.debugMode=function(){
		debugMode('on');
		this.options.autoPrintLvl=1;
		return this;
	}

   	//Used to determine if we're in the same file
	BetterLog._envDetails.first=prepareInFileMarker(firstLineMarker);
	BetterLog._envDetails.last=prepareInFileMarker(new Error('Last line marker:'));

}((typeof window !== 'undefined' ? window : (typeof global!='undefined' ? global : this)) || {}));
//simpleSourceMap=
//simpleSourceMap2=
	





/*
Errors: Linux System Errors
URL https://www-numi.fnal.gov/offline_software/srt_public_context/WebDocs/Errors/unix_system_errors.html
Last modified : 11/15/2019 12:59:06
Contact: Nick West (n.west1@physics.oxford.ac.uk>) 

Here is a copy of that file as of Aug 2004 on RedHat 7.3
Errors: Linux System Errors
URL https://www-numi.fnal.gov/offline_software/srt_public_context/WebDocs/Errors/unix_system_errors.html
Last modified : 11/15/2019 12:59:06
Contact: Nick West (n.west1@physics.oxford.ac.uk>) 

Here is a copy of that file as of Aug 2004 on RedHat 7.3


EPERM			(1) Operation not permitted
ENOENT			(2) No such file or directory
ESRCH			(3) No such process
EINTR			(4) Interrupted system call
EIO				(5) I/O error
ENXIO			(6) No such device or address
E2BIG			(7) Arg list too long
ENOEXEC			(8) Exec format error
EBADF			(9) Bad file number
ECHILD			(10) No child processes
EAGAIN			(11) Try again
ENOMEM			(12) Out of memory
EACCES			(13) Permission denied
EFAULT			(14) Bad address
ENOTBLK			(15) Block device required
EBUSY			(16) Device or resource busy
EEXIST			(17) File exists
EXDEV			(18) Cross-device link
ENODEV			(19) No such device
ENOTDIR			(20) Not a directory
EISDIR			(21) Is a directory
EINVAL			(22) Invalid argument
ENFILE			(23) File table overflow
EMFILE			(24) Too many open files
ENOTTY			(25) Not a typewriter
ETXTBSY			(26) Text file busy
EFBIG			(27) File too large
ENOSPC			(28) No space left on device
ESPIPE			(29) Illegal seek
EROFS			(30) Read-only file system
EMLINK			(31) Too many links
EPIPE			(32) Broken pipe
EDOM			(33) Math argument out of domain of func
ERANGE			(34) Math result not representable
EDEADLK			(35) Resource deadlock would occur
ENAMETOOLONG	(36) File name too long
ENOLCK			(37) No record locks available
ENOSYS			(38) Function not implemented
ENOTEMPTY		(39) Directory not empty
ELOOP			(40) Too many symbolic links encountered
EWOULDBLOCK		(41) Operation would block again
ENOMSG			(42) No message of desired type
EIDRM			(43) Identifier removed
ECHRNG			(44) Channel number out of range
EL2NSYNC		(45) Level 2 not synchronized
EL3HLT			(46) Level 3 halted
EL3RST			(47) Level 3 reset
ELNRNG			(48) Link number out of range
EUNATCH			(49) Protocol driver not attached
ENOCSI			(50) No CSI structure available
EL2HLT			(51) Level 2 halted
EBADE			(52) Invalid exchange
EBADR			(53) Invalid request descriptor
EXFULL			(54) Exchange full
ENOANO			(55) No anode
EBADRQC			(56) Invalid request code
EBADSLT			(57) Invalid slot
EDEADLOCK		(58) Dead lock 
EBFONT			(59) Bad font file format
ENOSTR			(60) Device not a stream
ENODATA			(61) No data available
ETIME			(62) Timer expired
ENOSR			(63) Out of streams resources
ENONET			(64) Machine is not on the network
ENOPKG			(65) Package not installed
EREMOTE			(66) Object is remote
ENOLINK			(67) Link has been severed
EADV			(68) Advertise error
ESRMNT			(69) Srmount error
ECOMM			(70) Communication error on send
EPROTO			(71) Protocol error
EMULTIHOP		(72) Multihop attempted
EDOTDOT			(73) RFS specific error
EBADMSG			(74) Not a data message
EOVERFLOW		(75) Value too large for defined data type
ENOTUNIQ		(76) Name not unique on network
EBADFD			(77) File descriptor in bad state
EREMCHG			(78) Remote address changed
ELIBACC			(79) Can not access a needed shared library
ELIBBAD			(80) Accessing a corrupted shared library
ELIBSCN			(81) .lib section in a.out corrupted
ELIBMAX			(82) Attempting to link in too many shared libraries
ELIBEXEC		(83) Cannot exec a shared library directly
EILSEQ			(84) Illegal byte sequence
ERESTART		(85) Interrupted system call should be restarted
ESTRPIPE		(86) Streams pipe error
EUSERS			(87) Too many users
ENOTSOCK		(88) Socket operation on non-socket
EDESTADDRREQ	(89) Destination address required
EMSGSIZE		(90) Message too long
EPROTOTYPE		(91) Protocol wrong type for socket
ENOPROTOOPT		(92) Protocol not available
EPROTONOSUPPORT	(93) Protocol not supported
ESOCKTNOSUPPORT	(94) Socket type not supported
EOPNOTSUPP		(95) Operation not supported on transport endpoint
EPFNOSUPPORT	(96) Protocol family not supported
EAFNOSUPPORT	(97) Address family not supported by protocol
EADDRINUSE		(98) Address already in use
EADDRNOTAVAIL	(99) Cannot assign requested address
ENETDOWN		(100) Network is down
ENETUNREACH		(101) Network is unreachable
ENETRESET		(102) Network dropped connection because of reset
ECONNABORTED	(103) Software caused connection abort
ECONNRESET		(104) Connection reset by peer
ENOBUFS			(105) No buffer space available
EISCONN			(106) Transport endpoint is already connected
ENOTCONN		(107) Transport endpoint is not connected
ESHUTDOWN		(108) Cannot send after transport endpoint shutdown
ETOOMANYREFS	(109) Too many references: cannot splice
ETIMEDOUT		(110) Connection timed out
ECONNREFUSED	(111) Connection refused
EHOSTDOWN		(112) Host is down
EHOSTUNREACH	(113) No route to host
EALREADY		(114) Operation already in progress
EINPROGRESS		(115) Operation now in progress
ESTALE			(116) Stale NFS file handle
EUCLEAN			(117) Structure needs cleaning
ENOTNAM			(118) Not a XENIX named type file
ENAVAIL			(119) No XENIX semaphores available
EISNAM			(120) Is a named type file
EREMOTEIO		(121) Remote I/O error
EDQUOT			(122) Quota exceeded
ENOMEDIUM		(123) No medium found
EMEDIUMTYPE		(124) Wrong medium type
ESEQ			Commands out of sequence
*/

