const log=require('../better_log.js')._syslog.debugMode();

try{
	log.fuck();
}catch(err){
	console.log(err);
	console.log('-------')
	console.log(log.makeError(err));
}

// var info=log.makeEntry('info','hello')
// console.log('IS ERROR:',info instanceof Error) //false
// console.log(info); //will only print object like any other
console.log('-------')
var error=log.makeError('hello')
// console.log('IS ERROR:',error instanceof Error) //true
console.log(error.code);
console.log(error);//will print .stack followed by object. Stack will begin with 'BetterLogError:...'
console.log(error.setCode('test'));//will print .stack followed by object. Stack will begin with 'test:...'