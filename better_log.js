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
	
	//Export from module if available
    if(typeof module === 'object' && module.exports){
        module.exports = BetterLog;
        BetterLog._env='terminal';   //will be overwritten if 'window' is also available vv
    }

    //Set on window if available
    if(typeof window === 'object'){
    	window.BetterLog=BetterLog;
        BetterLog._env='browser'; 
    }




	const logLvl=[
		{str:'trace',STR:'TRACE',nr:1,colorTerm:96,colorBrow:'background:cyan;color:black',print:console.debug}
		,{str:'debug',STR:'DEBUG',nr:2,colorTerm:94,colorBrow:'background:#5862f3;color:white',print:console.debug}
		,{str:'info',STR:'INFO',nr:3,colorTerm:92,colorBrow:'background:#3bd473;color:black',print:console.log}
		,{str:'note',STR:'NOTE',nr:4,colorTerm:93,colorBrow:'background:#f23dfb;color:white',print:console.warn}
		,{str:'warn',STR:'WARN',nr:5,colorTerm:91,colorBrow:null,print:console.warn}
		,{str:'error',STR:'ERROR',nr:6,colorTerm:101,colorBrow:null,print:console.error}
	]

	//For faster lookup, create a lookup table who's keys are both number and string id's of levels
	const lvlLookup={};
	logLvl.forEach(obj=>{lvlLookup[obj.str]=obj;lvlLookup[obj.nr]=obj;})

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
			Bright Black    90      100
			Bright Red      91      101
			Bright Green    92      102
			Bright Yellow   93      103
			Bright Blue     94      104
			Bright Magenta  95      105
			Bright Cyan     96      106
			Bright White    97      107
		*/
	const highlightColor={
		'red':{colorTerm:41,colorBrow:'red'}
		,'blue':{colorTerm:44,colorBrow:'blue'}
		,'magenta':{colorTerm:45,colorBrow:'magenta'}
		,'pink':{colorTerm:105,colorBrow:'pink'}
		,'green':{colorTerm:42,colorBrow:'green'}
		,'yellow':{colorTerm:43,colorBrow:'yellow'}
		,'cyan':{colorTerm:46,colorBrow:'cyan'}
	}




	function getLogLvl(x=3,d=3){
		return (lvlLookup.hasOwnProperty(x) ? lvlLookup[x].nr : d);
	}

	const defaultOptions={
		autoPrintLvl:5 //Lowest level to get printed automatically when entry in created, default everything, 0==off
		,lowestLvl:1 //Lowest level to even process, used only by the shortcuts this.debug|info etc... (set to at least 2 in production)
		,appendSyslog:true
		,printStackLvl:0 //0==off, the lowest level at which to print stack
		,printStackLines:0 //0==all, or rather see Error.stackTraceLimit. number of lines of stack to print at most
		,checkForMarks:true //true => will check for marks produced by BetterLog.markApply()
		,hideParentStack:false //true==when printing bubbled stacks, remove lines also present it parent stack
		,printColor:true
		,printWhere:true //appends each line with file:line:index of log
		,printFunc:true
		,printId:false
		,printTime:false
		,printMs:true //will override printTime
		,printSelfOnLvl:0 //0==off. only available in browser, prints BLE object as last extra if lvl >=
		,name:null //Overrides this.toString(). Gets printed with each message. May be appeneded with interger if not unique
		,namePrefix:false //Printed before name. Default nothing. Suitable for default options or one-time use, else just use 'name'
		,breakOnError:false
		,msgLength:1000     //The longest printed msg string of an entry    NOTE: in browser objects are printed live, ie. this doesn't apply
		,extraLength:1000   //The longest printed extra string of an entry   ^^

		,hideInternalStack:true //true==remove stack entries that refers to internal stuff. Only works as static option
		,rootPath:(typeof process=='object'&&process&&process.cwd?process.cwd():false) //root path that will be replaced by '.' from ALL paths (stack + end of line)
		,fileOnly:true //overrides rootPath, only prints the file, not entire path
		,hideThisFileStack:true //true==remove stack entries comming from this file. Can be turned off if packing into single file removes too much
	}

	//This will get set by the first instance to be created 
	var startTime;

	//Since this file can add a bunch of lines to the stack, change it from default of 10 to 20
	try{
		if(Error.stackTraceLimit==10)
			Error.stackTraceLimit=20
	}catch(err){console.error(err)}

	/*
	* Constructor
	*
	* @param any 	unit 			Something to identify the log when filtering later. MUST BE UNIQUE
	* @param object options
	*/
	function BetterLog(unit,options={}){

		const self=this;

		Object.defineProperty(this,'_isBetterLog',{value:true});

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
			  //this.toString() in this.changeName() works
		}

		//Find and set a unique name for this instance. NOTE: this will also set on _instances
		this.changeName(this.options.name)



		//First instance => set start time
		if(!startTime)
			this.resetStartTime();

		/*
		* @prop array entries 	All entries of this array. Gets appeneded by BetterLogEntry.exec()
		*/
		this.entries=Array();


		//Secret array to hold all listeners to this log
		Object.defineProperty(this,'_listeners',{value:[]});


		/*
		* @prop object codes 	Keys are short strings, values are longer descriptions.
		*
		* NOTE: Used by this.throwCodes. If specific key isn't found, see BetterLog.prototype._codes
		*/
		this.codes={}



		//To enable passing logging functions to iterators or as callbacks we define several shortcuts
		//on this instance, bound to this instance (or using self-object)

			//Define methods for each of the log levels on 'this', bound to this instance, so we don't have 
			//to worry about context when calling them (eg. when passing them)
			function callBetterLogFunc(obj,msg,...extra){
				//^ NOTE: So we can easily filter away calls to within this file even in complex circumstances 
				//        we make sure the name of the func includes 'BetterLog'
				try{
					//If we're ignoring below this level, just return the fakeEntry
					if(obj.nr>=this.options.lowestLvl){
						this.makeEntry.apply(this,[obj.nr,msg].concat(extra)).exec();
					}

				}catch(err){
					console.error(`BUGBUG BetterLog.${obj.str}():`);
					console.error(err, err.stack);
					console.error("Arguments:",msg,extra)
				}

				//Unlike makeEntry/makeError etc. this func doesn't return anything... so we never expect them to 
				//return anything... so when ignoring lower levels of logs in production we know not to use thse
				//shorthands, if we need the entry we just makeEntry explicitly
				return;
			}
			logLvl.forEach(obj=>{
				Object.defineProperty(this, obj.str, {
					enumerable:true
					,value:callBetterLogFunc.bind(this,obj)
				})
			})




		/*
		* Alias for .info (so a better log instance can be passed as console...)
		*/
		Object.defineProperty(this,'log',{enumerable:false, writable:true, configurable:true, value:this.info});

		/*
		* @see this.makeTrace()
		*
		* @return void 		Like this.trace, this method returns nothing
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
			return;
		}

		/*
		* Works like this.trace but it adds the 'from' part
		*
		* @return void 		Like this.trace, this method returns nothing
		*/
		this.traceFrom=function(msg,...extra){
			try{
				if(self.options.lowestLvl==1){
					//Allow the use of 'to' instead
					let preposition='from', i=extra.indexOf('to');
					if(i>-1){
						extra.splice(i,1);
						preposition='to';
					}
					//Make a trace, then proceed like regular logging, appending it, emitting it, printing it...
					self.makeEntry.apply(self,[1,msg].concat(extra)).addFrom(preposition).exec();
				}
			}catch(err){
				console.error('BUGBUG',err);
			}
			return;
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
			self.makeError.apply(self, args).exec().getFirstError().throw();
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
			
			// return Promise.reject('[@ '+entry.func+'()] '+String(entry.msg)); //2019-03-16: Why only reject with string?? trying to change...
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
			var color='red';
			if(typeof args[0]=='string' && highlightColor.hasOwnProperty(args[0]))
				color=args.shift();

			//If no level was given, default to 'note'
			if(!logLvl.hasOwnProperty(args[0]))
				args.unshift('note');

			//Now create, colorize, print and return the entry 
			return self.makeEntry.apply(self,args).highlight(color).exec('force');
		}


		/*
		* Create and throw a BLE with a code. @see this.makeCodeError()
		*
		* @throws <BLE>
		* @return n/a
		* @not_printed
		*/
		this.throwCode=function(code,...args){
			//If a code and description was previously stored, prepend $args with said description
			if(self.codes[code])
				args.unshift(self.codes[code]);
		
			self.makeError(...args).throw(code);
		}

	//done defining bound shortcuts..



	}//End of BetterLog constructor
	

	
	BetterLog._BetterLogEntry=BetterLogEntry;
	
	BetterLog.varType=varType;
	BetterLog.logVar=logVar;
	BetterLog.parseStackLine=parseStackLine;




    /*
    * Extend version of native Map class which supports "aliases". This gives the ability to use multiple
    * "keys" for the same value, without affecting size or iteration
    */
    BetterLog.BetterMap=BetterMap;
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
	        	return __delete(key)}}  
	    })
	    return map;
	}
	


	//...then use it to hold all created instances							  
	BetterLog._instances=BetterMap();






	Object.defineProperty(BetterLog,'_sourceMap',{value:{}})
	Object.defineProperties(BetterLog._sourceMap,{
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


			BetterLog._sourceMap[file]=data.split(';')
				.map(line=>{let arr=line.split('=');arr[0]=Number(arr[0])-1;return arr;})
				.filter(arr=>arr.length==2 && typeof arr[0]=='number' && typeof arr[1]=='string');

			BetterLog._syslog.info("Added simpleSourceMap for "+file,BetterLog._sourceMap[file]);
			
			//Clear cache since we may have added previously cached missing stuff
			BetterLog._sourceMap.cache={};


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
			if(BetterLog._sourceMap.cache.hasOwnProperty(str))
				return BetterLog._sourceMap.cache[str];

			var arr=str.split(':')
				,pos=arr.pop()
				,line=arr.pop()
				,file=arr.join(':')
			;

			if(BetterLog._sourceMap.hasOwnProperty(file)){
				let list=BetterLog._sourceMap[file];
				for(let i=list.length-1;i>=0;i--){
					if(line>list[i][0]){

						//Empty values (which are used to mark the end of a file) implies that this
						//line is outside any map and we jump to bottom and handle as such
						if(!list[i][1])
							break;

						var source=`${list[i][1]}:${line-list[i][0]}:${pos}`;
						if(prependOrigin)
							source=document.location.origin+source;
						BetterLog._sourceMap.cache[str]=source
						return source;
					}   					
				}
			}

			//If we didn't find anything we don't want to search again next time, so store the string with
			//an empty str
			BetterLog._sourceMap.cache[str]=undefined
			return undefined;
		}}

		,length:{get:function length(){
			return Object.keys(BetterLog._sourceMap).length
		}}
	})

























	BetterLog.prototype._isLog=BetterLog._isLog=function(x){
		if(x && typeof x=='object' && x.constructor.name=='BetterLog'){
			// if(!(x instanceof BetterLog)){
			// 	BetterLog._syslog.warn("BetterLog has been exported at least twice:",BetterLog._syslog, x.constructor._syslog)
			// }
			return true;
		}else{
			return false;
		} 
	}

	/*
	* The string of the log is a representation of the 'unit' and is intended to be the same for
	* logs created with objects from the same constructor, which facilitates filtering logs for a
	* given class
	*
	* @return string
	*/
	BetterLog.prototype.toString=function(){
		switch(BetterLog.varType(this.unit)){
			case 'string':
				return this.unit;
			case 'object':
				return this.unit.constructor.name;
			case 'function':
				return this.unit.name;
			default:
				return 'BetterLog';
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


		//If this.unit is a string it needs to get changed too, since both this.unit and this.name should be unique
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





	BetterLog.markApply=function(mark,func,args){
		//To speed up the matching process we only allow marks to contains numbers...
		mark=String(mark);
		if(!mark.match(/^[0-9]+$/))
			throw new Error("EINVAL. Arg #1 should be a 'mark' containing only [0-9], got: "+mark);

		//...however, for some reason numbers won't show up in the stack the way we need them for this to work, so we 
		//append '_mark' (but getStackArray() won't include it in it's capture group so entry.stack.mark == $mark)
		mark+='_mark'

		//Create an object with a distinctive name... (getStackArray() looks for it later)
		var obj={};

		//...then dynamically set a method on the object named $mark which will  cause $mark to show 
		//up in all stack traces nested below this call
		obj[mark]=()=>func.apply(this,args)


		//Now call!
		return obj[mark]()
	}














		




















/********************** Create entries *******************************/





	/*
	* Create <BLE> without printing or storing anything
	* @return <BLE>
	*/
	BetterLog.prototype.makeEntry=function(lvl,msg,...extra){

		//Get a lvl number (and deal with people forgetting lvl altogether)
		var logLvl=getLogLvl(lvl,'a');
		if(logLvl=='a'){
			if(msg!=undefined)
				extra.unshift(msg);
			msg=lvl;
			lvl=3;
		}

		//If msg is a BLE, just change .lvl, .log and add .extras, but don't create a new instance
		if(BetterLogEntry._isBLE(msg)){
			
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

	//2020-07-10: trying to place these 2 cases vv in BLE constructor??
		// }else if(msg instanceof Error){

		// 	if(msg instanceof SyntaxError){
		// 		extra.unshift(getSyntaxErrorDescription(msg));
		// 	}
				
		// 	var entry=new BetterLogEntry(this,lvl,msg.message,extra,msg.stack);	
		// 	if(msg.code)
		// 		entry.setCode(msg.code);
		// 	else if(msg.name!='Error')
		// 		entry.setCode(msg.name);
			
		// 	return entry;

		// //If we have a former JSON str, turn back into entry. 
		// }else if(isJsonBLE(msg)){
		// 	// console.log('BLE json about to be converted:',msg);
		// 	var entry=new BetterLogEntry(this,lvl,msg.msg,msg.extra.concat(msg.bubble,extra),msg.stack);
		// 		//^by adding bubble to extra array it automatically gets passed back to this function by BLE constructor
			
		// 	//Set props that can't be passed to constructor
		// 	entry.code=msg.code;
		// 	entry.timestamp=msg.timestamp
		// 	entry.handling=msg.handling
		// 	entry.printed=extra.length?false:msg.printed //like above, if we've added to extra, reset print

		// 	return entry;

		} else {
			//...else create a new one
			return new BetterLogEntry(this,lvl,msg,extra);
		}
	}
	
	BetterLog.prototype.makeEntryRaw=function(lvl,msg,extra,stack){
		return new BetterLogEntry(this,lvl,msg,extra,stack);
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
		logLvl=getLogLvl(logLvl);

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
			var all=[msg].concat(got.map(arg=>logVar(arg,100)));
		}else{
			all=[msg].concat(got);
		}
		return this.makeError.apply(this,all).setCode('TypeError');
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
				var [cb,low,high]=this._listeners[i];
				//Ignore if outside lvl span
				if(entry.lvl<low || entry.lvl>high)
					return;

				try{
					cb(entry)
				}catch(err){
					console.error(`Uncaught error in BetterLog listener ${i}:`,err,cb,entry)
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

		return this._listeners.push([callback,getLogLvl(lowestLvl,1),getLogLvl(highestLvl,6)])-1;
	}

	/*
	* Remove a listener
	* @param number id 		The id returned by .listen()
	* @return void
	*/
	BetterLog.prototype.ignore=function(id){
		if(this._listeners.hasOwnProperty(id))
			delete this._listeners[id]; //NOTE: delete, don't splice, so that id of others don't change
	}















	/*
	* Add entries from another log to the current one, emitting again...
	*
	* @param <BetterLog> anotherLog 	Another instance of BetterLog
	*
	* @return number 	@see anotherLog.listen()
	*/
	BetterLog.prototype.extend=function(anotherLog){
		if(!BetterLog._isLog(anotherLog)||anotherLog===this)
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
		if(!BetterLog._isLog(anotherLog)||anotherLog===this)
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
		lowestLvl = getLogLvl(lowestLvl,1);
		
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
		}else if(unit===null || !(BetterLog._isLog(this)))  
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
	* @return void
	*/
	BetterLog.prototype.dump=function(options={},criteria=undefined){
		//Set some default options, letting passed in ones overrule...
		options=Object.assign({
			printMs:false //printing ms will give negative numbers if startTime has been reset, so just turn it off
		},options);
		
		var entries=(typeof criteria=='object' ? this.find(criteria) : this.get());
		if(!entries.length)
			console.log("No matching entries found.");
		else
			entries.forEach(entry=>{entry.printed=false; entry.print(options)});
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
	* Utility function, gives more descriptive type of variable
	*
	* @return string     Beyond the regular 
	*						object,bigint,symbol,string,number,boolean,function,undefined 
	*					it can also return
	*						null,array,ble,error,promise,nodelist,node
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
			if(BetterLogEntry._isBLE(v)){ //adding this since BLEs now ARE an instanceof Error
				return 'ble'
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
			return typeof v
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
	//2020-06-11: It seems errors thrown in here, like by this faulty line:
	// 	var total=optional.first(opt=>typeof opt=='number');
	// cause the "TypeError: stack.startsWith is not a function" node bug...
		var total=optional.find(opt=>typeof opt=='number');
		var noType=typeof total=='number' || optional.includes('noType');
		
		var type=BetterLog.varType(v);
		var printType='<'+type+'>';
		switch(type){ 
			case 'undefined':
			case 'null':
				return printType;
			case 'ble':
				return `<(ble)${v.toString()}>`;
			case 'error':
				return `<${v.constructor.name}:${v.message}>`;

			case 'object':
				//"regular" objects like {foo:'bar'}, leave type as 'object' and stringify value
				if(v.constructor.name=='Object'){
					// console.log('a')
					v=makeJsonLikeString(v,maxLength,type,total);
					break;
				}
				if(isJsonBLE(v)){
					// console.log('b')
					return `<(ble)${BetterLog._syslog.makeEntry(v.lvl, v).toString()}>`;
				}

				//all other objects, set their types to the constructor, and their values 
				//either custom toString() method or stringify like ^^
				printType='<'+v.constructor.name+'>'
				var x=String(v),y=Object.prototype.toString.call(v)
				if(y!=x){
					// console.log('c')
					v=x; //custom toString()
					//since ^ may have returned a too long string, and 'object' doesn't normally get handled shortened vv,
					//we change 'type'...
					type='pleaseshortenmyobject';
				}else if(total){
					// console.log('d')
					return printType;
				}else{
					// console.log('e')
					v=makeJsonLikeString(v,maxLength,type,total);
				}
				
				break;

			case 'arguments':
				printType='<arguments:'+v.length+'>'
				v=Object.values(v);
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

		//So we don't loop unecessarily or waste time on super short ones... but if any errors happen
		//while trying to save time, just proceed to the loooong way of doing it...
		try{
			var str;
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

			var temp={},over=[],extra=0,i=0,l=keys.length,even=Math.floor(maxLength/l);
			for(i;i<l;i++){
				let key=keys[i];
				try{
					str=logVar(obj[key],maxLength,total);
				}catch(err){
					str=`<err:${err.message}>`
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
				over.forEach((key,i)=>{
					if(temp[key].length>even){
						let short=temp[key].substr(0,even-3)+'...'+temp[key].substr(-1); //just assume the last char is } ] "
						// console.log(i,key,temp[key].length,' --> ',short.length)
						temp[key]=short;
					}
				})
			}

			var add=(key)=>{
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
			try{
				console.warn(err);
				console.verbose(obj);
				str=JSON.stringify(obj);
				return str.substr(0,maxLength-4)+'...'+str.substr(-1);
			}catch(err){
				return `<err:${err.message}. See console.verbose^>`
			}
		}
	}

    

	

















	/*
	* @opt <Error>|string|array errOrStack		An error who's stack to use, or just the .stack string, or an array which
	*											has previously been returned by this method. If omitted one will be generated here. 
	*
	* @return array[{where,func}...] || array[{empty:true}]  Array of objects. Non-enum prop 'original' contains original stack
	*/
	BetterLog.prototype.getStackArray=function(errOrStack=undefined){
		var stackArr,stackStr,mark;
		let nostack='[original stack lost]';
		if(Array.isArray(errOrStack) && typeof errOrStack[0]=='object'){
			//We assume that an array passed in has already gone through this process...
			stackArr=errOrStack;
			if(errOrStack.original==nostack)
				stackStr='[original stack lost by parent]'
			else
				stackStr=errOrStack.original||'[BUGBUG: prop "original" not set on pre-processed stack array]';

		}else{
			if(typeof errOrStack=='string')
				stackStr=errOrStack
			else if(errOrStack instanceof Error)
				stackStr=errOrStack.stack
			else
				stackStr=Error().stack;


			//Some errors need special handling...
			if(stackStr.includes('SyntaxError:') && !stackStr.startsWith('Error')){
				stackArr=handleSyntaxErrorStack(stackStr);
			}else if(stackStr.startsWith('ReferenceError: ')){
				stackArr=handleReferenceErrorStack(stackStr);
			}else if(stackStr.startsWith('Error: Cannot find module')){
				stackArr=handleModuleNotFoundStack(stackStr);
			}else{
				//Now we either have an array or a string, the later must become the former
				stackArr = splitStackString(stackStr);
			}
			
			//NOTE: duplicate lines are handled when we print...

			//Turn strings into array of objects
			stackArr=stackArr.map(parseStackLine); //protip: the original string is kept in line.orig

			//Optionally check for marks produced by BetterLog.markApply()
			if(this.options.checkForMarks){
				//NOTE: only the most recent mark is found
				stackArr.find(obj=>{
					let m=obj.func.match(/\[as ([0-9]+)_mark\]/)
					if(m){
						//Save it for and set it vv when setting original
						mark=m[1]
						return true;
					}
					return false;
				})
			}


			//Now handel depending on env. The first (only) job here is to remove references to this file
			if(BetterLog._env=='terminal'){

				//Remove all calls produced by this file
				stackArr=stackArr.filter(obj=>obj.where.includes(__filename)==false);
				
				//Optionally remove stack entries that refer to internal modules and have little informative
				//value to a developer of other modules
				if(this.options.hideInternalStack){
					stackArr=removeInternalStack(stackArr);
				}

				//Now either use filename only or replace rootPath
				if(this.options.fileOnly)
					stackArr.forEach(line=>line.where=line.where.slice(line.where.lastIndexOf('/')+1))
				else
					stackArr.forEach(line=>line.where.replace(this.options.rootPath,'.'))

			}else{
				//If a simpleSourceMap exists, apply it
				if(BetterLog._sourceMap.length){
					stackArr.forEach(obj=>obj.where=BetterLog._sourceMap.lookup(obj.where,true)||obj.where);
				}
				if(this.options.hideThisFileStack){
					removeTopLinesFromThisFile.call(this,stackArr);
				}else{
					stackArr=stackArr(stackArr).filter(obj=>obj.func.includes('BetterLog'))
				}
			}
		}

		//for debug purposes, save the original stack. (NOTE: if you change here, also change in handleSyntaxErrorStack())
		Object.defineProperties(stackArr,{
			'original':{value:stackStr||nostack}
			,'mark':{value:mark}
		});

		//Always make sure there is at least on one item in stack, that way we don't have to worry about errors
		if(!stackArr.length)
			stackArr.push({'empty':true})

		return stackArr
	}
	

	/*
	* Remove lines from stack that refer to internal stuff
	*
	* @param array(object) stackArray
	*
	* @return array
	*/
	function removeInternalStack(stackArr){
		return stackArr.filter((obj,i)=>{
			//always keep first line of stack
			if(i===0)
				return true;
			if(obj.where.startsWith('internal/'))
				return false;
			if(obj.where.startsWith('vm.js:'))
				return false;
			if(obj.where.startsWith('module.js:'))
				return false;
			if(obj.where.includes('bootstrap_node.js:'))
				return false;
			
			return true;
		})
	}


	/*
	* NOTE: The returned array from this method DOES NOT get further processed by getStackArray(), as such
	*		we add the same 'original' prop to it like would otherwise have been done by ^
	*
	* @return array[object]
	*/
	function handleSyntaxErrorStack(str){
		try{
			var stackArr = str.split(/\r\n|\r|\n/);
			
			//The first line contains where the syntax error was detected, then a few lines of garbage, then the rest...
			var skip=true;
			stackArr=str.split(/\r\n|\r|\n/)
				.map((line,i,arr)=>{
					// console.log(i,line);
					if(i==0 || skip==false){
						return line.trim();
					}else{
						//we ignore lines until (including) the line that explains the error...
						if(line.includes('SyntaxError:')){
							skip=false;
						}
						return ''; //empty line implies we skip it
					}
				})
				.filter(line=>line) //get rid of empty lines
			;

			Object.defineProperty(stackArr,'original',{value:str});
			return stackArr;
		}catch(err){
			console.error(str);
			return [];
		}
	}


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
	* @param string line		A line single line from the stack which contains calling function, file, line
	*
	* @return object{where:string, func:string}
	* @no_throw
	*/
	function parseStackLine(line){
		var obj={where:'unknown', func:'unknown'};
		try{
			if(!line)
				throw 'sss'

			line=line.replace(/^\s*at /,'').trim();

			var s=line.indexOf('(');
			obj.func=line.substring(0,s-1);//calling func

			var w=line.substring(s+1);
			obj.where=(w.substring(w.length-1)==')' ? w.substring(0,w.length-1) : w); //fileline
			

		}catch(err){
			obj.orig=line;
		}

		return obj
	}



	function splitStackString(stackStr){
		return stackStr.split(/\r\n|\r|\n/) //Turn into array (windows and unix compatible)
			.slice(1) //first row just says 'Error'
	}


	/*
	* Remove the first lines from the stack that come from this same file. 
	*
	* NOTE: This will remove too much if you've bundled all your scripts and 
	*		have not applied simpleSourceMaps
	*
	* @param array[object] stackArr
	* @return array 						Alters and returns live $stackArr
	* @call(<BetterLog>)
	*/
	function removeTopLinesFromThisFile(stackArr){
		if(typeof this.options.hideThisFileStack!='string'){
			let stack=Error().stack
				,first=splitStackString(stack)[0]
				,where=parseStackLine(first).where
				,i=where.indexOf('.js:')
			;
			if(i==-1)
				i=where.indexOf('.js?:');
			if(i==-1){
				console.warn("Could not determine the first filename of this stack:",stack);
				return stackArr;
			}
			this.options.hideThisFileStack=where.substr(0,i)+'.js';
		}		
		var i=0,l=stackArr.length;
		for(i;i<l;i++){
			if(stackArr[i].where.indexOf(this.options.hideThisFileStack)!=0)
				break;
		}
		stackArr.splice(0,i);
		return stackArr;
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
	* SyntaxErrors contain a bit that describes where the syntax error was detected... get that bit
	* @param <SyntaxError> err
	* @return string
	*/
	function getSyntaxErrorDescription(err){
		var description='',arr=err.stack.split(/\r\n|\r|\n/),i,l=arr.length;
		for(i=1;i<l;i++){
			if(arr[i].match('SyntaxError: '))
				break;
			description+='\n'+arr[i] //if we put \n after we get correct newlines, but we get problems with indents... try it...
		}
		return description;
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
		Object.defineProperties(this,{ //set by reject() or throw();
			_code:{enumerable:false,configurable:true,writable:true,value:null}
			,code:{enumerable:true,get:this.getCode.bind(this),set:this.setCode.bind(this)}

			,_options:{value:{}}
			,options:{enumerable:true,get:()=>Object.assign({},this.log.options,this._options),set:this.setOptions.bind(this)}

			,_isBetterLogEntry:{value:true}
			,_rocks:{value:[]} //inverted bubbles, so we can track...
			,_age:{get:()=>Date.now()-this.timestamp}
			,'where':{enumerable:true, get:()=>this.stack[0].where||'<unknown whereabouts>'}
			,'func':{enumerable:true, get:()=>this.stack[0].func||'<unknown function>'}
		})
		this.lvl=getLogLvl(lvl,4); //Can be changed later manually before printing...
		this.msg=msg; 
		this.extra=(Array.isArray(extra)?extra:(extra!=undefined?[extra]:[]));
		//NOTE: these 5 props ^^ are defined first so they show up first in Chrome DevTools when expanding entries in console...
		
		this.timestamp=Date.now();
		this.handling=[]; //call this.addHandling() will append this list. NOT for bubbling up.
		this.printed=false;

		//If an error was passed in as main message...
		if(msg instanceof Error){
			this.msg=msg.message;

			if(msg instanceof SyntaxError)
				this.extra.unshift(getSyntaxErrorDescription(msg));
				
			if(msg.code)
				this.setCode(msg.code);
			else if(msg.name!='Error')
				this.setCode(msg.name);

			stack=msg.stack; //same handling as passed in stack vv 

		}else if(isJsonBLE(msg)){
			this.msg=msg.msg;

			//Before setting 'extra' vv, if any more were passed in here ^, reset print...
			this.printed=this.extra.length?false:msg.printed

			this.extra=msg.extra.concat(msg.bubble,extra); //the bubble will be moved out of extra vv, ie. same handling as everything else

			this.setCode(msg.code);
			this.timestamp=msg.timestamp
			this.handling=msg.handling

			stack=msg.stack; //same handling as passed in stack vv 
		}

		this.log=(BetterLog._isLog(log) ? log : BetterLog._syslog);

		this.setStack(stack); //stores the $stack, but doesn't actually process until it's needed (this is also where .func and .where comes from)

		this.bubble=null;
		var i;
		for(i=0;i<this.extra.length;i++){
			let x=this.extra[i]; 
			if(typeof x=='object'){
				if(BetterLogEntry._isBLE(x)) {
				  //^we have to check for BLE before Error, since BLE is an error... that's why we have a little duplication
				  //of code vv
					this.bubble=this.extra.splice(i,1)[0];
					// this.code=this.bubble.code; //code bubbles up as well //2019-11-05: see vv
				}else if(x instanceof Error || isJsonBLE(x)){
					this.bubble=new BetterLogEntry(this.log, x.lvl||6, this.extra.splice(i,1)[0]);
					// this.code=this.bubble.code; //2019-11-05: Doesn't make sense to bubble, we can still get it with getCode()
				}

				if(this.bubble){
					this.bubble._rocks.push(this); 			
					break; //we assume only a single Error or BLE is passed in
				}
				

			}
		}


		//There is a bug in node (version?) which throws 'TypeError: stack.startsWith is not a function' in some async cases... 
		if(this.code=='TypeError' && this.msg.startsWith('stack.startsWith is not a function')){
			this.setCode('BUGBUG')
			this.msg="Node bug 'TypeError: stack.startsWith is not a function' caused by something on this line";
			
			//For this to show the right location, internal lines need to be removed...
			if(!this.log.options.hideInternalStack)
				this.stack=removeInternalStack(this.stack);
			
			//removeInternalStack() leaves the first line... remove it and set .where and .func at the same time
			this.changeWhere(1);
			
		} else if(this.code=='RangeError' && this.msg.startsWith('Maximum call stack size')){
			this.setStack(this.stack.slice(this.stack.length-10));
		}


	}//end of BetterLogEntry
	BetterLogEntry.prototype=Object.create(Error.prototype); 
	Object.defineProperty(BetterLogEntry.prototype, 'constructor', {value: BetterLogEntry}); 
//2019-10-10: Trying to make BLE's pass for Errors so we can start using them as such... Right now checking in uniSoc
//			  if 'err instanceof Error'
	BetterLogEntry.prototype._isBLE=BetterLogEntry._isBLE=function(x){
		if(x && typeof x=='object' && x.constructor.name=='BetterLogEntry' && typeof x.changeWhere=='function'){
			// if(x.log && !(x.log instanceof BetterLog)){
			// 	BetterLog._syslog.warn("BetterLog has been exported at least twice:",BetterLog._syslog, x.log.constructor._syslog)
			// }
			return true;
		}else{
			return false;
		} 
	}


	/*
	* Only certain things are suitable to turn into json string, get there here
	*
	* @return object
	*/
	BetterLogEntry.prototype.toJSON=function(){
		var obj={
			log:this.log.name
			,id:this.id
			,code:this.code
			,lvl:this.lvl
			,msg:this.msg
			,extra:this.extra
			,timestamp:this.timestamp
			,printed:this.printed
			,handling:this.handling
			,stack:this.stack
			,where:this.where
			,func:this.func
			,bubble:this.bubble?this.bubble.toJSON():null
			,__ble:true
		}
		// console.log('BLE json str:',JSON.stringify(obj));
		return obj;
	}


	function isJsonBLE(obj){
		return (obj && typeof obj=='object' && obj.__ble);
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
	* @return string 	The	code+message+extras of this entry (no where,bubble or handling) 
	*/
	BetterLogEntry.prototype.toString=function(){
		//Start by grabbing the message and the extras
		return addInfo([],null,this._code,this.msg,null,this.extra,this.options)
			.map(x=>logVar(x,300,'noType')).join(' ').replace('\n',' ');
	}


	/*
	* @return string|number|null 	The first code of this or any bubbled entry, or null
	*/
	BetterLogEntry.prototype.getCode=function(){
		var self=this
		while(self){
			if(self._code)
				return self._code;
			self=self.bubble
		}
		return null;
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
	* Look for the first error by following this.bubble
	* @return <ble> 	Either this entry, or a previous one 	
	*/
	BetterLogEntry.prototype.getFirstError=function(){
		var self=this
		while(self.bubble){
			self=self.bubble
		}
		return self;
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
	BetterLogEntry.prototype.highlight=function(color,otherOptions=null,asLog=null){
	
		//Default to red
		color=(typeof color=='string' && highlightColor.hasOwnProperty(color)) ? color:'red'
		

		//Set options
		var c=highlightColor[color];
		this.setOptions({
			colorTerm:String(`${c.colorTerm};${lvlLookup['note'].colorTerm}`)
			,colorBrow:`background:${c.colorBrow}` //NOTE: replaces default
			,autoPrintLvl:1
		})

		return this;
	}


	/*
	* Set (or change) the stack for this entry
	*
	* @param <Error>|string|array errOrStack 	@see getStackArray
	*
	* @return this
	*/
	BetterLogEntry.prototype.setStack=function(errOrStack){
		//Make sure we have an stack/err since getStackArray() won't be called from here/now
		errOrStack=errOrStack||(new Error()).stack
		
		//Define a getter so we don't have to parse the stack unless it's actually needed...
		var futureStack;
		Object.defineProperty(this,'stack',{enumerable:true,configurable:true
			,get:()=>{
				if(!futureStack)
					futureStack=this.log.getStackArray(errOrStack);
				return futureStack

			//2020-05-27: why does vv not work? can't change the descriptor... ^works for now, but it doesn't feel right...
				// let stack=this.log.getStackArray(errOrStack);
				
				// //On the first call we store it for real 
				// Object.defineProperty(this,stack,{enumerable:true, configurable:true, writable:true, value:stack})

				// return stack;
			}
		})

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
	BetterLogEntry.prototype.appendStack=function(errOrStack){
		//Start by parsing the new stack
		var newStack=this.log.getStackArray(errOrStack);

		//Then append the old stack
		this.setStack(this.stack.concat(newStack));

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
		this.stack.splice(0,removeLines); 

		return this;
	}

	/*
	* Add 'from ${stack[1]}' to this entry
	*
	* @opt string preposition 	Optionally have it say something other than 'from', eg. like 'to'
	*
	* @return this
	*/
	BetterLogEntry.prototype.addFrom=function(preposition='from'){
		if(this.stack.length>1){
			//stack[0] should be the first func outside this file, so stack[1] will be the the func that
			//called that guy...
			var {func,where}=this.stack[1];
			this.append(` ${preposition} ${func} (${where})`);
		}else{
			console.warn("Why is stack so short? Cannot trace...",this);
			this.append(` from UNKNOWN`);
		}
		return this;
	}

	BetterLogEntry.prototype.addTo=function(){
		return this.addFrom('to');
	}






	/*
	* Change the log lvl of this entry. 
	* @param string|number lvl
	* @return this
	*/
	BetterLogEntry.prototype.changeLvl=function(lvl){
		this.lvl=getLogLvl(lvl);
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
			var stack=this.log.getStackArray((typeof handling=='object' && handling.stack) ? handling.stack:(new Error()).stack);

			// this.handling.unshift({where:where,what:handling,extra:extra}); //Add to top of handling stack
	 	  //2019-10-10: Changing this to bottom of stack. Thinking: Original error is on top, so any later added 
	 	  //			messages (even if the error is bubbling up), is added later => lower down in list
			this.handling.push({where:stack[0].where,what:handling,extra:extra}); 
		}catch(err){
			console.error('Not adding handling to entry.',err);
		}
		return this;
	}



	BetterLogEntry.prototype.prepend=function(pre){
		if(typeof pre!='string')
			return this;

		if(typeof this.msg=='string'){
			//Make sure msg doesn't already contain the same string
			if(this.msg.toLowerCase().replace(/[.:,;]/g,'').includes(pre.toLowerCase().replace(/[.:,;]/g,'')))
				return this;

			//Make sure it ends in a whitespace
			if(!pre[pre.length-1].match(/\s/))
				pre+=' '

			this.msg=pre+this.msg
		}else{
			this.extra.unshift(this.msg);
			this.msg=pre;
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

		if(typeof this.msg=='string' && (!this.extra.length || typeof this.extra[0]!='string')){
			this.msg+=end;
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
	* Make sure a string exists somewhere in the error, else add it as an extra
	*
	* @param string str
	*
	* @return this
	*/
	BetterLogEntry.prototype.somewhere=function(str){
		//Check along the entire bubble chain...
		var self=this;
		while(self){
			//Does the message contain it?
			if(typeof self.msg=='string' && self.msg.includes(str))
				return this;

			//Is it one of the extras??
			if(self.extra.find(xtra=>typeof xtra=='string' && xtra.includes(str)))
				return this;

			self=self.bubble;
		}

		//If we're still running, add it!
		return this.addExtra(str);

	}


	/*
	* Add one or more items to the .extra array.
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
	* 'Handle an entry', ie. add it to log/syslog, emit it, print it
	*
	* NOTE: An entry can be emitted and appended multiple times, but won't be printed multiple times. To force a re-print
	*		then use this.print() instead
	*
	* @secret flag 'force' 	If passed the entry will be handled regardless of level
	*
	* @return this
	*/
	BetterLogEntry.prototype.exec=function(){

		//Check that we're not ignoring this lvl...
		if(arguments[0]=='force' || this.log.options.lowestLvl<=this.lvl){

			//If our log appends the syslog or is a seperate log altogether...
			if(this.options.appendSyslog){
				//Add to syslog and use returned 'length' value as id for entry 
				// entry.id=BetterLog._syslog.push(entry); //changed to vv when we changed syslog to BetterLog
				this.id=BetterLog._syslog.entries.push(this)-1; 
				this.log.entries.push(this);
			}else{
				this.id=this.log.entries.push(this)-1;
			}

			//Emit on our log before emitting on syslog so that listening on this log takes
			//presidence in printing
			this.log.emit(this); //Filtering on lvl happens inside...
			if(this.options.appendSyslog)
				BetterLog._syslog.emit(this); //Filtering on lvl happens inside...


			//Possible auto-printing happens AFTER the entry has been emitted. If it's
			//printed there it won't be printed again...
			if(this.options.autoPrintLvl && this.lvl>=this.options.autoPrintLvl && this.printed==false)
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
	* @param object options 	The options to use
	* @return array[string] 	Array of all the lines of the entry
	* @call(ble)
	*/
	function toPrintArray(options){
	//2020-07-09	
	// if(this.msg.includes('Maximum call stack size exceeded')){
	// 	console.log('toPrintArray() - original stack:')
	// 	console.log(this.stack.original);
	// }
		try{
			//Create the array to hold all the pieces we'll print
			var arr=[];

			//Mark the entry as printed, so anyone else getting it will know it's been...
			this.printed=true;


			options=Object.assign({},lvlLookup[this.lvl],options);

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

			//name of who is doing the printing... could be the "unit", could be the function...
				var name=options.name||this.log ? this.log.name:'';
				if(name){

					if(options.printFunc && this.func){ 
						var func=this.func.replace(name,'') //if func contains name, remove so we don't get duplicates
										   .replace(/Object\.<anonymous>/,''); //this gives zero information... just remove

						//Remove the "unit string" from the func since the name is what we're using (if unit is Foo{}, then 
						//the name will either be "Foo" (set by constructor) or "Bar" (option), and we don't want
						//"Foo.Foo" or "Foo.Bar", we just want "Foo" or "Bar"
						if(this.log && typeof this.log.unit=='object') 
							func=func.replace(this.log.unit.constructor.name,'')
						
						if(func)
							name=(name+'.'+func).replace('..','.');
					}
				
				}else if(options.printFunc){ 
					name=this.func+'()';
				}else{
					name=this.where;
				}


				if(options.namePrefix)
					name=options.namePrefix+name
				
				
				if(name){
					name='['+name+']';
					if(options.printColor)
						if(BetterLog._env=='terminal')
							name=wrapInBashColor(name,33);
						else{
							//NOTE: this works together with the block below, where colorBrow is used 
							name='%c'+name+'%c'; 
							options.colorBrow=['font-weight:bold','font-weight:initial',options.colorBrow];
						}

					arr.push(name,'-');
				}
			
			//log lvl string
			if(options.printColor){
				switch(BetterLog._env){
					case 'browser':
						if(options.colorBrow) //in browsers, warn and error are already colored, so colorBrow=null at top ^^
							//NOTE: The console.log in browsers has a requirement - only the first string can 
							//be colorized, so we combine anything already in arr and add the level
							arr=[arr.join(' ')+` %c ${options.STR} `].concat(options.colorBrow); //works both if colorBrow is string as default, 
																				 //or array created above ^^
						else
							arr.push(options.STR)			
						break;
					case 'terminal':
					default:
						arr.push(wrapInBashColor(options.STR,options.colorTerm));
				}
			}else{
				arr.push(options.STR); 
			}
			arr.push('-')


			//Main msg
			addInfo(arr,'',this._code,this.msg,this.where,this.extra,options,3);		

			//Stack
			if(options.printStackLvl && this.lvl>=options.printStackLvl){
				oneNewline(arr)
				let indent=' '.repeat(3);
				let max=options.printStackLines||100;
				let stack=(this.stack.length>max ? removeDuplicateLines(this.stack) : this.stack)
				if(stack.length){
					arr.push(`${indent}[Stack]`)
					arr.push.apply(arr,stack.map(line=>{
						let func=(line.func=='unknown' ? line.orig : line.func)
							,where=(line.func=='unknown' && line.where=='unknown' ? '':` (${line.where})`)
							,repeat=(line.repeat?` [${line.repeat} times]`:'');
						;
						return `\n${indent} | ${func}${where}${repeat}`
					}));
				}
			}

			//Handling 
			var pre=' -->';
			if(this.handling){
				this.handling.forEach(({what,where,extra})=>{
					oneNewline(arr) 
					addInfo(arr,pre,null,what,where,extra,options,pre.length+2)
				})
			}


			
			//If opted, in browser, add log so we can easily check previous messages
			if(options.printSelfOnLvl && options.printSelfOnLvl<=this.lvl && BetterLog._env=='browser'){
				oneNewline(arr)
				arr.push(this);
			}

			
			//In Chromiums console, if the first item in arr is a number, all the string items get quoted,
			//so just to make it look pretty, make sure the first item is a string
			arr[0]=String(arr[0]);


			//Finally add a print method to the array and return it
			Object.defineProperty(arr,'print',{value:lvlLookup[this.lvl].print});
		}catch(err){
			console.error('BUGBUG in BetterLogEntry.prototype.toPrintArray():')
			console.error(' ',err);
		}

		return arr;

	}





	/*
	* Print the entry.
	*
	* NOTE: This method prints the entry even if it's been previously printed
	* NOTE2: This method group-prints all bubbles that have not yet been printed, while referencing those that have
	*
	* @return this
	*/
	BetterLogEntry.prototype.print=function(oneTimeOptions={},asLog=null){
		try{
			//Start by combining all options
			var log=BetterLog._isLog(asLog) ? asLog : this.log 
			var options=Object.assign({},log.options,this._options,oneTimeOptions);

			//Then loop through any bubbled entries and get their output...
			var bubbles=[], self=this;
			while(self.bubble){
				self=self.bubble;
				if(self.printed){
					let arr=["See previously printed entry ",(self.id ? "#"+self.id : logVar(self.msg,18,'noType'))]
					arr.print=lvlLookup[self.lvl].print;
					bubbles.push(arr);
				}else
					bubbles.push(toPrintArray.call(self,options));
			}
			//...and if any exists then group them and print the oldest one first
			if(bubbles.length){
				console.group(`--- ${lvlLookup[this.lvl].STR} ---`);
				var i;
				if(BetterLog._env=='terminal'){
					for(var i=bubbles.length-1; i>=0;i--){
						console.group();
					}
				}else{
					for(var i=bubbles.length-1; i>=0;i--){
						console.group(' ');
					}
				}
				for(var i=bubbles.length-1; i>=0;i--){
					bubbles[i].print.apply(null,bubbles[i]);
					console.groupEnd();
				}
			}

			//Now print the current entry
			var arr=toPrintArray.call(this,options);
			arr.print.apply(null,arr);

			//If we had a group before, print a closing line
			if(bubbles.length){
				console.groupEnd();
				if(BetterLog._env=='terminal')
					console.log('--- end ---');
			}
		}catch(err){
			console.error("BUGBUG: BetterLogEntry.print() failed.",err,this);
		}

		return this;
	}




	/*
	* Wrap string in bash color codes
	* @return string
	*/
	function wrapInBashColor(str,...colors){
		return colors.map(c=>'\x1b['+c+'m').join('')+str+'\x1b[0m';
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
		,terminal:function(printArray,item,len=0){printArray.push(typeof item=='object' ? logVar(item,len) : item);}
	}


	/*
	* Add msg/extra/handling/bubble to the array
	*
	* @return $arr 		The same array that was passed in
	*/
	function addInfo(arr,pre,code,msg,where,extra,options,extraIndent){
		var push=pushItem[BetterLog._env].bind(this,arr)
			,xl=options.extraLength //strings in extra can be this long         NOTE: in browser objects are live, ie. not converted to strings, 
			,ml=options.msgLength //strings in main message can be this long          ie. not subject to this limit
		;

		//First we combine pre and code
		pre=String(pre||'')
		if(code||code===0)
			pre+=String(code)+': '

		if(typeof msg=='string')
			push(pre+msg,ml+pre.length);	
		else if(pre){
			push(pre);
			push(msg,ml);
		}else
			push(msg,ml);

		//As long as all we're logging is primitives they can go on the same row, otherwise we want each on it's own row.
		var useNewline=false;
		if(typeof msg=='object'){
			addWhere(where,options,arr);
			useNewline=true;
			oneNewline(arr);
		}
		if(extra){
			(Array.isArray(extra) ? extra : [extra]).forEach((xtra,i)=>{
				if(useNewline || (typeof xtra=='string' && xtra.match(/\n/))||(typeof xtra=='object' && (i>0 || !(xtra instanceof Error) ) )){
					if(!useNewline) //on the first newline, also add the where
						addWhere(where,options,arr);
					oneNewline(arr,extraIndent);
					// arr.push(xtra); 
					push(xtra,xl);
					useNewline=true;
				}else{
					// arr.push(xtra); 
					push(xtra,xl);
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
		if(where==null)
			return;

		if(options.printWhere){
			where='@ '+where.trim();
		}else
			return 
		
		if(options.printColor && BetterLog._env=='terminal'){ //add color if opted and we're in bash
			where=wrapInBashColor(where, 33,100)+wrapInBashColor('.',30); //extra dot to try and prevent color to end of terminal window
		}

		arr.push(where);
	}













	//Setup first log, the syslog!
	BetterLog._syslog=new BetterLog('_syslog',{appendSyslog:false});

}(typeof window !== 'undefined' ? window : this || {}) );
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

