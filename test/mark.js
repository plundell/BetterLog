const log=require('../better_log.js')._syslog.debugMode();
const mark='<foo>'


function Foo(){
	let entry=Bar();
	return entry.addExtra('Marks: '+entry.getMarks().join(', '))
		.addExtra(`. Has '${mark}':`,entry.hasMark(mark))
		.exec()
	;
}

function Bar(){
	return log.makeEntry('info','Inside Bar.');
}


log.note("Without mark:");
if(Foo().hasMark(mark)){
	log.error("An unexpected mark appeared");
}

log.note("With mark:");
log.constructor.markAndRun(mark,()=>{
	if(!Foo().hasMark(mark)){
		log.error("An expected mark did not appear")
	}
});

{
	let ble, intercepted=false;
	log.note(`Intercepting:`);
	log.runAndInterceptLogs(
		function func(){
			console.log('this function should run first')
			ble=Bar();
			ble.exec();
		}
		,function intercept(entry){
			let msg='this intercept should run after,';
			if(!ble){
				console.log(msg,'original func hasnt run yet')
			}else if(ble==entry){
				console.log(msg,'intercepted the right entry')
				intercepted=true
			}else{
				console.log(msg,'intercepted another entry')
			}

		}
	);
	console.log('now intercepting has ended')
	if(!intercepted)
		log.error("Intercepting didn't work")
}


