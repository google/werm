#define WERM_JS 1
#undef WERM_C

#define TMint var
#define fn0(name)			function name()
#define fn1(name, a0)			function name(a0)
#define fn2(name, a0, a1)		function name(a0, a1)
#define fn3(name, a0, a1, a2)		function name(a0, a1, a2)
#define fn4(name, a0, a1, a2, a3)	function name(a0, a1, a2, a3)
#define fn5(name, a0, a1, a2, a3, a4)	function name(a0, a1, a2, a3, a4)

var bufsa = [];
var bufsfreehead = -1;

#define fld(obj, ndx) (bufsa[~(obj)][ndx])

// jsobj* functions are a kludge to allow saving arbitrary objects in a buffer
// while porting is still ongoing.
#define jsobj(fld) (bufsa[~(fld)])

function jsobj_alloc(what)
{
	var i;

	if (0 > bufsfreehead) {
		i = bufsa.length;
		bufsa.push(what);
	}
	else {
		i = bufsfreehead;
		bufsfreehead = bufsa[bufsfreehead];
		bufsa[i] = what;
	}

	return ~i;
}

function tmalloc(size) { return jsobj_alloc(new Int32Array(size)); }

function tmlen(bref) { return bufsa[~bref].length; }

function tmfree(bref)
{
	bufsa[~bref] = bufsfreehead;
	bufsfreehead = ~bref;
}
