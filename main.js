"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };
var $unused = function(v) {};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (high === undefined) {
    high = slice.$length;
  }
  if (max === undefined) {
    max = slice.$capacity;
  }
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  if (slice === slice.constructor.nil) {
    return slice;
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = high - low;
  s.$capacity = max - low;
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, pkg, exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.embedded) {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.embedded) {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr(
      $packages["runtime"]._type.ptr.nil,
      (value === $ifaceNil ? $packages["runtime"]._type.ptr.nil : new $packages["runtime"]._type.ptr(value.constructor.string)),
      new $packages["runtime"]._type.ptr(type.string),
      missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $noGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [] };
var $curGoroutine = $noGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $noGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $schedule($goroutine);
};

var $scheduled = [];
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
  } finally {
    if ($scheduled.length > 0) {
      setTimeout($runScheduled, 0);
    }
  }
};

var $schedule = function(goroutine) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }
  $scheduled.push(goroutine);
  if ($curGoroutine === $noGoroutine) {
    $runScheduled();
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if ($curGoroutine === $noGoroutine) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if ($isASCII(v)) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var result = v.apply(passThis ? this : undefined, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if ($isASCII(v)) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

/* $isASCII reports whether string s contains only ASCII characters. */
var $isASCII = function(s) {
  for (var i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 128) {
      return false;
    }
  }
  return true;
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, sliceType$1, ptrType, ptrType$1, Keys, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	sliceType$1 = $sliceType($String);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	Keys = function(o) {
		var a, i, o, s;
		if (o === null || o === undefined) {
			return sliceType$1.nil;
		}
		a = $global.Object.keys(o);
		s = $makeSlice(sliceType$1, $parseInt(a.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(a.length))) { break; }
			((i < 0 || i >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + i] = $internalize(a[i], $String));
			i = i + (1) >> 0;
		}
		return s;
	};
	$pkg.Keys = Keys;
	init = function() {
		var e;
		e = new Error.ptr(null);
		$unused(e);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", embedded: false, exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/cpu"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/bytealg"] = (function() {
	var $pkg = {}, $init, cpu;
	cpu = $packages["internal/cpu"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = cpu.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, bytealg, sys, _type, TypeAssertionError, errorString, ptrType, ptrType$4, init, GOROOT, Goexit, throw$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	bytealg = $packages["internal/bytealg"];
	sys = $packages["runtime/internal/sys"];
	_type = $pkg._type = $newType(0, $kindStruct, "runtime._type", true, "runtime", false, function(str_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.str = "";
			return;
		}
		this.str = str_;
	});
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(_interface_, concrete_, asserted_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this._interface = ptrType.nil;
			this.concrete = ptrType.nil;
			this.asserted = ptrType.nil;
			this.missingMethod = "";
			return;
		}
		this._interface = _interface_;
		this.concrete = concrete_;
		this.asserted = asserted_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType = $ptrType(_type);
	ptrType$4 = $ptrType(TypeAssertionError);
	_type.ptr.prototype.string = function() {
		var t;
		t = this;
		return t.str;
	};
	_type.prototype.string = function() { return this.$val.string(); };
	_type.ptr.prototype.pkgpath = function() {
		var t;
		t = this;
		return "";
	};
	_type.prototype.pkgpath = function() { return this.$val.pkgpath(); };
	init = function() {
		var e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = throw$1;
		e = $ifaceNil;
		e = new TypeAssertionError.ptr(ptrType.nil, ptrType.nil, ptrType.nil, "");
		$unused(e);
	};
	GOROOT = function() {
		var process, v, v$1;
		process = $global.process;
		if (process === undefined) {
			return "/";
		}
		v = process.env.GOPHERJS_GOROOT;
		if (!(v === undefined)) {
			return $internalize(v, $String);
		} else {
			v$1 = process.env.GOROOT;
			if (!(v$1 === undefined)) {
				return $internalize(v$1, $String);
			}
		}
		return "/usr/local/go";
	};
	$pkg.GOROOT = GOROOT;
	Goexit = function() {
		$curGoroutine.exit = $externalize(true, $Bool);
		$throw(null);
	};
	$pkg.Goexit = Goexit;
	throw$1 = function(s) {
		var s;
		$panic(new errorString((s)));
	};
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var as, cs, e, inter, msg;
		e = this;
		inter = "interface";
		if (!(e._interface === ptrType.nil)) {
			inter = e._interface.string();
		}
		as = e.asserted.string();
		if (e.concrete === ptrType.nil) {
			return "interface conversion: " + inter + " is nil, not " + as;
		}
		cs = e.concrete.string();
		if (e.missingMethod === "") {
			msg = "interface conversion: " + inter + " is " + cs + ", not " + as;
			if (cs === as) {
				if (!(e.concrete.pkgpath() === e.asserted.pkgpath())) {
					msg = msg + (" (types from different packages)");
				} else {
					msg = msg + (" (types from different scopes)");
				}
			}
			return msg;
		}
		return "interface conversion: " + cs + " is not " + as + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val;
		return "runtime error: " + (e);
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType.methods = [{prop: "string", name: "string", pkg: "runtime", typ: $funcType([], [$String], false)}, {prop: "pkgpath", name: "pkgpath", pkg: "runtime", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	_type.init("runtime", [{prop: "str", name: "str", embedded: false, exported: false, typ: $String, tag: ""}]);
	TypeAssertionError.init("runtime", [{prop: "_interface", name: "_interface", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "concrete", name: "concrete", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "asserted", name: "asserted", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "missingMethod", name: "missingMethod", embedded: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", true, "errors", false, function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init("errors", [{prop: "s", name: "s", embedded: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release;
	Acquire = function(addr) {
		var addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var addr;
	};
	$pkg.Release = Release;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, js, race, runtime, atomic, Pool, Mutex, poolLocalInternal, poolLocal, notifyList, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$6, ptrType$7, sliceType$4, funcType, ptrType$16, arrayType$2, semWaiters, semAwoken, expunged, allPools, runtime_registerPoolCleanup, runtime_SemacquireMutex, runtime_Semrelease, runtime_notifyListCheck, runtime_canSpin, runtime_nanotime, throw$1, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", true, "sync", true, function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$4.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", true, "sync", true, function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	poolLocalInternal = $pkg.poolLocalInternal = $newType(0, $kindStruct, "sync.poolLocalInternal", true, "sync", false, function(private$0_, shared_, Mutex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$4.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", true, "sync", false, function(poolLocalInternal_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.poolLocalInternal = new poolLocalInternal.ptr($ifaceNil, sliceType$4.nil, new Mutex.ptr(0, 0));
			this.pad = arrayType$2.zero();
			return;
		}
		this.poolLocalInternal = poolLocalInternal_;
		this.pad = pad_;
	});
	notifyList = $pkg.notifyList = $newType(0, $kindStruct, "sync.notifyList", true, "sync", false, function(wait_, notify_, lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wait = 0;
			this.notify = 0;
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.wait = wait_;
		this.notify = notify_;
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$6 = $ptrType($Int32);
	ptrType$7 = $ptrType(poolLocal);
	sliceType$4 = $sliceType($emptyInterface);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$16 = $ptrType(Mutex);
	arrayType$2 = $arrayType($Uint8, 100);
	Pool.ptr.prototype.Get = function() {
		var _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } */ case 4:
			$s = -1; return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		$s = -1; return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var cleanup;
	};
	runtime_SemacquireMutex = function(s, lifo) {
		var _entry, _entry$1, _entry$2, _entry$3, _entry$4, _key, _key$1, _key$2, _r, ch, lifo, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _entry$4 = $f._entry$4; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _r = $f._r; ch = $f.ch; lifo = $f.lifo; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (((s.$get() - (_entry = semAwoken[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : 0) >>> 0)) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (((s.$get() - (_entry = semAwoken[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : 0) >>> 0)) === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			if (lifo) {
				_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $appendSlice(new sliceType$1([ch]), (_entry$1 = semWaiters[ptrType$1.keyFor(s)], _entry$1 !== undefined ? _entry$1.v : sliceType$1.nil)) };
			} else {
				_key$1 = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$1)] = { k: _key$1, v: $append((_entry$2 = semWaiters[ptrType$1.keyFor(s)], _entry$2 !== undefined ? _entry$2.v : sliceType$1.nil), ch) };
			}
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
			_key$2 = s; (semAwoken || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$2)] = { k: _key$2, v: (_entry$3 = semAwoken[ptrType$1.keyFor(s)], _entry$3 !== undefined ? _entry$3.v : 0) - (1) >>> 0 };
			if ((_entry$4 = semAwoken[ptrType$1.keyFor(s)], _entry$4 !== undefined ? _entry$4.v : 0) === 0) {
				delete semAwoken[ptrType$1.keyFor(s)];
			}
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_SemacquireMutex }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._entry$4 = _entry$4; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._r = _r; $f.ch = ch; $f.lifo = lifo; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s, handoff) {
		var _entry, _entry$1, _key, _key$1, ch, handoff, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _key = $f._key; _key$1 = $f._key$1; ch = $f.ch; handoff = $f.handoff; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			$s = -1; return;
		}
		ch = (0 >= w.$length ? ($throwRuntimeError("index out of range"), undefined) : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		_key$1 = s; (semAwoken || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key$1)] = { k: _key$1, v: (_entry$1 = semAwoken[ptrType$1.keyFor(s)], _entry$1 !== undefined ? _entry$1.v : 0) + (1) >>> 0 };
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._key = _key; $f._key$1 = _key$1; $f.ch = ch; $f.handoff = handoff; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_notifyListCheck = function(size) {
		var size;
	};
	runtime_canSpin = function(i) {
		var i;
		return false;
	};
	runtime_nanotime = function() {
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	throw$1 = function(s) {
		var s;
		$throwRuntimeError($externalize(s, $String));
	};
	Mutex.ptr.prototype.Lock = function() {
		var awoke, delta, iter, m, new$1, old, queueLifo, starving, waitStartTime, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; awoke = $f.awoke; delta = $f.delta; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; queueLifo = $f.queueLifo; starving = $f.starving; waitStartTime = $f.waitStartTime; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire((m));
			}
			$s = -1; return;
		}
		waitStartTime = new $Int64(0, 0);
		starving = false;
		awoke = false;
		iter = 0;
		old = m.state;
		/* while (true) { */ case 1:
			/* */ if (((old & 5) === 1) && runtime_canSpin(iter)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (((old & 5) === 1) && runtime_canSpin(iter)) { */ case 3:
				if (!awoke && ((old & 2) === 0) && !(((old >> 3 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
					awoke = true;
				}
				runtime_doSpin();
				iter = iter + (1) >> 0;
				old = m.state;
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			new$1 = old;
			if ((old & 4) === 0) {
				new$1 = new$1 | (1);
			}
			if (!(((old & 5) === 0))) {
				new$1 = new$1 + (8) >> 0;
			}
			if (starving && !(((old & 1) === 0))) {
				new$1 = new$1 | (4);
			}
			if (awoke) {
				if ((new$1 & 2) === 0) {
					throw$1("sync: inconsistent mutex state");
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 5) === 0) {
					/* break; */ $s = 2; continue;
				}
				queueLifo = !((waitStartTime.$high === 0 && waitStartTime.$low === 0));
				if ((waitStartTime.$high === 0 && waitStartTime.$low === 0)) {
					waitStartTime = runtime_nanotime();
				}
				$r = runtime_SemacquireMutex((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), queueLifo); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				starving = starving || (x = (x$1 = runtime_nanotime(), new $Int64(x$1.$high - waitStartTime.$high, x$1.$low - waitStartTime.$low)), (x.$high > 0 || (x.$high === 0 && x.$low > 1000000)));
				old = m.state;
				if (!(((old & 4) === 0))) {
					if (!(((old & 3) === 0)) || ((old >> 3 >> 0) === 0)) {
						throw$1("sync: inconsistent mutex state");
					}
					delta = -7;
					if (!starving || ((old >> 3 >> 0) === 1)) {
						delta = delta - (4) >> 0;
					}
					atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), delta);
					/* break; */ $s = 2; continue;
				}
				awoke = true;
				iter = 0;
				$s = 7; continue;
			/* } else { */ case 6:
				old = m.state;
			/* } */ case 7:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire((m));
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.awoke = awoke; $f.delta = delta; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.queueLifo = queueLifo; $f.starving = starving; $f.waitStartTime = waitStartTime; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			$unused(m.state);
			race.Release((m));
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			throw$1("sync: unlock of unlocked mutex");
		}
		/* */ if ((new$1 & 4) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((new$1 & 4) === 0) { */ case 1:
			old = new$1;
			/* while (true) { */ case 4:
				if (((old >> 3 >> 0) === 0) || !(((old & 7) === 0))) {
					$s = -1; return;
				}
				new$1 = ((old - 8 >> 0)) | 2;
				/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 6:
					$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), false); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = -1; return;
				/* } */ case 7:
				old = m.state;
			/* } */ $s = 4; continue; case 5:
			$s = 3; continue;
		/* } else { */ case 2:
			$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), true); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	poolCleanup = function() {
		var _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? ($throwRuntimeError("index out of range"), undefined) : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < ((p.localSize >> 0)))) { break; }
				l = indexLocal(p.local, i$1);
				l.poolLocalInternal.private$0 = $ifaceNil;
				_ref$1 = l.poolLocalInternal.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.poolLocalInternal.shared, ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.poolLocalInternal.shared = sliceType$4.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var i, l, lp;
		lp = (((l) + ($imul(((i >>> 0)), 128) >>> 0) >>> 0));
		return ($pointerOfStructConversion(lp, ptrType$7));
	};
	init$1 = function() {
		var n;
		n = new notifyList.ptr(0, 0, 0, 0, 0);
		runtime_notifyListCheck(20);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$7], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$7], false)}];
	ptrType$16.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init("sync", [{prop: "local", name: "local", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", embedded: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "store", name: "store", embedded: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "New", name: "New", embedded: false, exported: true, typ: funcType, tag: ""}]);
	Mutex.init("sync", [{prop: "state", name: "state", embedded: false, exported: false, typ: $Int32, tag: ""}, {prop: "sema", name: "sema", embedded: false, exported: false, typ: $Uint32, tag: ""}]);
	poolLocalInternal.init("sync", [{prop: "private$0", name: "private", embedded: false, exported: false, typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", embedded: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "Mutex", name: "Mutex", embedded: true, exported: true, typ: Mutex, tag: ""}]);
	poolLocal.init("sync", [{prop: "poolLocalInternal", name: "poolLocalInternal", embedded: true, exported: false, typ: poolLocalInternal, tag: ""}, {prop: "pad", name: "pad", embedded: false, exported: false, typ: arrayType$2, tag: ""}]);
	notifyList.init("sync", [{prop: "wait", name: "wait", embedded: false, exported: false, typ: $Uint32, tag: ""}, {prop: "notify", name: "notify", embedded: false, exported: false, typ: $Uint32, tag: ""}, {prop: "lock", name: "lock", embedded: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "head", name: "head", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", embedded: false, exported: false, typ: $UnsafePointer, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		semAwoken = {};
		expunged = (new Uint8Array(8));
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, atomic, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	atomic = $packages["sync/atomic"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, EncodeRune;
	EncodeRune = function(p, r) {
		var i, p, r;
		i = ((r >>> 0));
		if (i <= 127) {
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((r << 24 >>> 24)));
			return 1;
		} else if (i <= 2047) {
			$unused((1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((192 | (((r >> 6 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			$unused((3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((240 | (((r >> 18 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 12 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, bytealg, io, unicode, utf8, errNegativeRead;
	errors = $packages["errors"];
	bytealg = $packages["internal/bytealg"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		errNegativeRead = errors.New("bytes.Buffer: reader returned negative count from Read");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bufio"] = (function() {
	var $pkg = {}, $init, bytes, errors, io, utf8, errNegativeRead, errNegativeWrite;
	bytes = $packages["bytes"];
	errors = $packages["errors"];
	io = $packages["io"];
	utf8 = $packages["unicode/utf8"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = errors.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrInvalidUnreadByte = errors.New("bufio: invalid use of UnreadByte");
		$pkg.ErrInvalidUnreadRune = errors.New("bufio: invalid use of UnreadRune");
		$pkg.ErrBufferFull = errors.New("bufio: buffer full");
		$pkg.ErrNegativeCount = errors.New("bufio: negative count");
		errNegativeRead = errors.New("bufio: reader returned negative count from Read");
		errNegativeWrite = errors.New("bufio: writer returned negative count from Write");
		$pkg.ErrTooLong = errors.New("bufio.Scanner: token too long");
		$pkg.ErrNegativeAdvance = errors.New("bufio.Scanner: SplitFunc returns negative advance count");
		$pkg.ErrAdvanceTooFar = errors.New("bufio.Scanner: SplitFunc returns advance count beyond input");
		$pkg.ErrFinalToken = errors.New("final token");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["image/color"] = (function() {
	var $pkg = {}, $init, Color, RGBA, RGBA64, NRGBA, NRGBA64, Alpha, Alpha16, Gray, Gray16, Model, modelFunc, YCbCr, NYCbCrA, CMYK, ptrType, funcType, ModelFunc, rgbaModel, rgba64Model, nrgbaModel, nrgba64Model, alphaModel, alpha16Model, grayModel, gray16Model, RGBToYCbCr, yCbCrModel, nYCbCrAModel, RGBToCMYK, cmykModel;
	Color = $pkg.Color = $newType(8, $kindInterface, "color.Color", true, "image/color", true, null);
	RGBA = $pkg.RGBA = $newType(0, $kindStruct, "color.RGBA", true, "image/color", true, function(R_, G_, B_, A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R = 0;
			this.G = 0;
			this.B = 0;
			this.A = 0;
			return;
		}
		this.R = R_;
		this.G = G_;
		this.B = B_;
		this.A = A_;
	});
	RGBA64 = $pkg.RGBA64 = $newType(0, $kindStruct, "color.RGBA64", true, "image/color", true, function(R_, G_, B_, A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R = 0;
			this.G = 0;
			this.B = 0;
			this.A = 0;
			return;
		}
		this.R = R_;
		this.G = G_;
		this.B = B_;
		this.A = A_;
	});
	NRGBA = $pkg.NRGBA = $newType(0, $kindStruct, "color.NRGBA", true, "image/color", true, function(R_, G_, B_, A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R = 0;
			this.G = 0;
			this.B = 0;
			this.A = 0;
			return;
		}
		this.R = R_;
		this.G = G_;
		this.B = B_;
		this.A = A_;
	});
	NRGBA64 = $pkg.NRGBA64 = $newType(0, $kindStruct, "color.NRGBA64", true, "image/color", true, function(R_, G_, B_, A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R = 0;
			this.G = 0;
			this.B = 0;
			this.A = 0;
			return;
		}
		this.R = R_;
		this.G = G_;
		this.B = B_;
		this.A = A_;
	});
	Alpha = $pkg.Alpha = $newType(0, $kindStruct, "color.Alpha", true, "image/color", true, function(A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.A = 0;
			return;
		}
		this.A = A_;
	});
	Alpha16 = $pkg.Alpha16 = $newType(0, $kindStruct, "color.Alpha16", true, "image/color", true, function(A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.A = 0;
			return;
		}
		this.A = A_;
	});
	Gray = $pkg.Gray = $newType(0, $kindStruct, "color.Gray", true, "image/color", true, function(Y_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Y = 0;
			return;
		}
		this.Y = Y_;
	});
	Gray16 = $pkg.Gray16 = $newType(0, $kindStruct, "color.Gray16", true, "image/color", true, function(Y_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Y = 0;
			return;
		}
		this.Y = Y_;
	});
	Model = $pkg.Model = $newType(8, $kindInterface, "color.Model", true, "image/color", true, null);
	modelFunc = $pkg.modelFunc = $newType(0, $kindStruct, "color.modelFunc", true, "image/color", false, function(f_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.f = $throwNilPointerError;
			return;
		}
		this.f = f_;
	});
	YCbCr = $pkg.YCbCr = $newType(0, $kindStruct, "color.YCbCr", true, "image/color", true, function(Y_, Cb_, Cr_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Y = 0;
			this.Cb = 0;
			this.Cr = 0;
			return;
		}
		this.Y = Y_;
		this.Cb = Cb_;
		this.Cr = Cr_;
	});
	NYCbCrA = $pkg.NYCbCrA = $newType(0, $kindStruct, "color.NYCbCrA", true, "image/color", true, function(YCbCr_, A_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.YCbCr = new YCbCr.ptr(0, 0, 0);
			this.A = 0;
			return;
		}
		this.YCbCr = YCbCr_;
		this.A = A_;
	});
	CMYK = $pkg.CMYK = $newType(0, $kindStruct, "color.CMYK", true, "image/color", true, function(C_, M_, Y_, K_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = 0;
			this.M = 0;
			this.Y = 0;
			this.K = 0;
			return;
		}
		this.C = C_;
		this.M = M_;
		this.Y = Y_;
		this.K = K_;
	});
	ptrType = $ptrType(modelFunc);
	funcType = $funcType([Color], [Color], false);
	RGBA.ptr.prototype.RGBA = function() {
		var a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		r = ((c.R >>> 0));
		r = (r | ((r << 8 >>> 0))) >>> 0;
		g = ((c.G >>> 0));
		g = (g | ((g << 8 >>> 0))) >>> 0;
		b = ((c.B >>> 0));
		b = (b | ((b << 8 >>> 0))) >>> 0;
		a = ((c.A >>> 0));
		a = (a | ((a << 8 >>> 0))) >>> 0;
		return [r, g, b, a];
	};
	RGBA.prototype.RGBA = function() { return this.$val.RGBA(); };
	RGBA64.ptr.prototype.RGBA = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		_tmp = ((c.R >>> 0));
		_tmp$1 = ((c.G >>> 0));
		_tmp$2 = ((c.B >>> 0));
		_tmp$3 = ((c.A >>> 0));
		r = _tmp;
		g = _tmp$1;
		b = _tmp$2;
		a = _tmp$3;
		return [r, g, b, a];
	};
	RGBA64.prototype.RGBA = function() { return this.$val.RGBA(); };
	NRGBA.ptr.prototype.RGBA = function() {
		var _q, _q$1, _q$2, a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		r = ((c.R >>> 0));
		r = (r | ((r << 8 >>> 0))) >>> 0;
		r = $imul(r, (((c.A >>> 0)))) >>> 0;
		r = (_q = r / (255), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		g = ((c.G >>> 0));
		g = (g | ((g << 8 >>> 0))) >>> 0;
		g = $imul(g, (((c.A >>> 0)))) >>> 0;
		g = (_q$1 = g / (255), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		b = ((c.B >>> 0));
		b = (b | ((b << 8 >>> 0))) >>> 0;
		b = $imul(b, (((c.A >>> 0)))) >>> 0;
		b = (_q$2 = b / (255), (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		a = ((c.A >>> 0));
		a = (a | ((a << 8 >>> 0))) >>> 0;
		return [r, g, b, a];
	};
	NRGBA.prototype.RGBA = function() { return this.$val.RGBA(); };
	NRGBA64.ptr.prototype.RGBA = function() {
		var _q, _q$1, _q$2, a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		r = ((c.R >>> 0));
		r = $imul(r, (((c.A >>> 0)))) >>> 0;
		r = (_q = r / (65535), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		g = ((c.G >>> 0));
		g = $imul(g, (((c.A >>> 0)))) >>> 0;
		g = (_q$1 = g / (65535), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		b = ((c.B >>> 0));
		b = $imul(b, (((c.A >>> 0)))) >>> 0;
		b = (_q$2 = b / (65535), (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		a = ((c.A >>> 0));
		return [r, g, b, a];
	};
	NRGBA64.prototype.RGBA = function() { return this.$val.RGBA(); };
	Alpha.ptr.prototype.RGBA = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		a = ((c.A >>> 0));
		a = (a | ((a << 8 >>> 0))) >>> 0;
		_tmp = a;
		_tmp$1 = a;
		_tmp$2 = a;
		_tmp$3 = a;
		r = _tmp;
		g = _tmp$1;
		b = _tmp$2;
		a = _tmp$3;
		return [r, g, b, a];
	};
	Alpha.prototype.RGBA = function() { return this.$val.RGBA(); };
	Alpha16.ptr.prototype.RGBA = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, a, b, c, g, r;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		a = ((c.A >>> 0));
		_tmp = a;
		_tmp$1 = a;
		_tmp$2 = a;
		_tmp$3 = a;
		r = _tmp;
		g = _tmp$1;
		b = _tmp$2;
		a = _tmp$3;
		return [r, g, b, a];
	};
	Alpha16.prototype.RGBA = function() { return this.$val.RGBA(); };
	Gray.ptr.prototype.RGBA = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, a, b, c, g, r, y;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		y = ((c.Y >>> 0));
		y = (y | ((y << 8 >>> 0))) >>> 0;
		_tmp = y;
		_tmp$1 = y;
		_tmp$2 = y;
		_tmp$3 = 65535;
		r = _tmp;
		g = _tmp$1;
		b = _tmp$2;
		a = _tmp$3;
		return [r, g, b, a];
	};
	Gray.prototype.RGBA = function() { return this.$val.RGBA(); };
	Gray16.ptr.prototype.RGBA = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, a, b, c, g, r, y;
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		y = ((c.Y >>> 0));
		_tmp = y;
		_tmp$1 = y;
		_tmp$2 = y;
		_tmp$3 = 65535;
		r = _tmp;
		g = _tmp$1;
		b = _tmp$2;
		a = _tmp$3;
		return [r, g, b, a];
	};
	Gray16.prototype.RGBA = function() { return this.$val.RGBA(); };
	ModelFunc = function(f) {
		var f;
		return new modelFunc.ptr(f);
	};
	$pkg.ModelFunc = ModelFunc;
	modelFunc.ptr.prototype.Convert = function(c) {
		var _r, c, m, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; c = $f.c; m = $f.m; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		_r = m.f(c); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: modelFunc.ptr.prototype.Convert }; } $f._r = _r; $f.c = c; $f.m = m; $f.$s = $s; $f.$r = $r; return $f;
	};
	modelFunc.prototype.Convert = function(c) { return this.$val.Convert(c); };
	rgbaModel = function(c) {
		var _r, _tuple, _tuple$1, a, b, c, g, ok, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, RGBA, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		a = _tuple$1[3];
		$s = -1; return (x = new RGBA.ptr((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)), (((a >>> 8 >>> 0) << 24 >>> 24))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: rgbaModel }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	rgba64Model = function(c) {
		var _r, _tuple, _tuple$1, a, b, c, g, ok, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, RGBA64, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		a = _tuple$1[3];
		$s = -1; return (x = new RGBA64.ptr(((r << 16 >>> 16)), ((g << 16 >>> 16)), ((b << 16 >>> 16)), ((a << 16 >>> 16))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: rgba64Model }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	nrgbaModel = function(c) {
		var _q, _q$1, _q$2, _r, _tuple, _tuple$1, a, b, c, g, ok, r, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, NRGBA, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		a = _tuple$1[3];
		if (a === 65535) {
			$s = -1; return (x = new NRGBA.ptr((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)), 255), new x.constructor.elem(x));
		}
		if (a === 0) {
			$s = -1; return (x$1 = new NRGBA.ptr(0, 0, 0, 0), new x$1.constructor.elem(x$1));
		}
		r = (_q = (($imul(r, 65535) >>> 0)) / a, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		g = (_q$1 = (($imul(g, 65535) >>> 0)) / a, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		b = (_q$2 = (($imul(b, 65535) >>> 0)) / a, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		$s = -1; return (x$2 = new NRGBA.ptr((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)), (((a >>> 8 >>> 0) << 24 >>> 24))), new x$2.constructor.elem(x$2));
		/* */ } return; } if ($f === undefined) { $f = { $blk: nrgbaModel }; } $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	nrgba64Model = function(c) {
		var _q, _q$1, _q$2, _r, _tuple, _tuple$1, a, b, c, g, ok, r, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, NRGBA64, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		a = _tuple$1[3];
		if (a === 65535) {
			$s = -1; return (x = new NRGBA64.ptr(((r << 16 >>> 16)), ((g << 16 >>> 16)), ((b << 16 >>> 16)), 65535), new x.constructor.elem(x));
		}
		if (a === 0) {
			$s = -1; return (x$1 = new NRGBA64.ptr(0, 0, 0, 0), new x$1.constructor.elem(x$1));
		}
		r = (_q = (($imul(r, 65535) >>> 0)) / a, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		g = (_q$1 = (($imul(g, 65535) >>> 0)) / a, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		b = (_q$2 = (($imul(b, 65535) >>> 0)) / a, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		$s = -1; return (x$2 = new NRGBA64.ptr(((r << 16 >>> 16)), ((g << 16 >>> 16)), ((b << 16 >>> 16)), ((a << 16 >>> 16))), new x$2.constructor.elem(x$2));
		/* */ } return; } if ($f === undefined) { $f = { $blk: nrgba64Model }; } $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	alphaModel = function(c) {
		var _r, _tuple, _tuple$1, a, c, ok, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; c = $f.c; ok = $f.ok; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, Alpha, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		a = _tuple$1[3];
		$s = -1; return (x = new Alpha.ptr((((a >>> 8 >>> 0) << 24 >>> 24))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: alphaModel }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.c = c; $f.ok = ok; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	alpha16Model = function(c) {
		var _r, _tuple, _tuple$1, a, c, ok, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; c = $f.c; ok = $f.ok; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, Alpha16, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		a = _tuple$1[3];
		$s = -1; return (x = new Alpha16.ptr(((a << 16 >>> 16))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: alpha16Model }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.c = c; $f.ok = ok; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	grayModel = function(c) {
		var _r, _tuple, _tuple$1, b, c, g, ok, r, x, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, Gray, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		y = ((((($imul(19595, r) >>> 0) + ($imul(38470, g) >>> 0) >>> 0) + ($imul(7471, b) >>> 0) >>> 0) + 32768 >>> 0)) >>> 24 >>> 0;
		$s = -1; return (x = new Gray.ptr(((y << 24 >>> 24))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: grayModel }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	gray16Model = function(c) {
		var _r, _tuple, _tuple$1, b, c, g, ok, r, x, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, Gray16, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		y = ((((($imul(19595, r) >>> 0) + ($imul(38470, g) >>> 0) >>> 0) + ($imul(7471, b) >>> 0) >>> 0) + 32768 >>> 0)) >>> 16 >>> 0;
		$s = -1; return (x = new Gray16.ptr(((y << 16 >>> 16))), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: gray16Model }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	RGBToYCbCr = function(r, g, b) {
		var b, b1, cb, cr, g, g1, r, r1, yy;
		r1 = ((r >> 0));
		g1 = ((g >> 0));
		b1 = ((b >> 0));
		yy = ((((($imul(19595, r1)) + ($imul(38470, g1)) >> 0) + ($imul(7471, b1)) >> 0) + 32768 >> 0)) >> 16 >> 0;
		cb = ((($imul(-11056, r1)) - ($imul(21712, g1)) >> 0) + ($imul(32768, b1)) >> 0) + 8421376 >> 0;
		if (((((cb >>> 0)) & 4278190080) >>> 0) === 0) {
			cb = (cb >> $min((16), 31)) >> 0;
		} else {
			cb = ~((cb >> 31 >> 0)) >> 0;
		}
		cr = ((($imul(32768, r1)) - ($imul(27440, g1)) >> 0) - ($imul(5328, b1)) >> 0) + 8421376 >> 0;
		if (((((cr >>> 0)) & 4278190080) >>> 0) === 0) {
			cr = (cr >> $min((16), 31)) >> 0;
		} else {
			cr = ~((cr >> 31 >> 0)) >> 0;
		}
		return [((yy << 24 >>> 24)), ((cb << 24 >>> 24)), ((cr << 24 >>> 24))];
	};
	$pkg.RGBToYCbCr = RGBToYCbCr;
	YCbCr.ptr.prototype.RGBA = function() {
		var b, c, cb1, cr1, g, r, yy1;
		c = this;
		yy1 = $imul(((c.Y >> 0)), 65793);
		cb1 = ((c.Cb >> 0)) - 128 >> 0;
		cr1 = ((c.Cr >> 0)) - 128 >> 0;
		r = yy1 + ($imul(91881, cr1)) >> 0;
		if (((((r >>> 0)) & 4278190080) >>> 0) === 0) {
			r = (r >> $min((8), 31)) >> 0;
		} else {
			r = (~((r >> 31 >> 0)) >> 0) & 65535;
		}
		g = (yy1 - ($imul(22554, cb1)) >> 0) - ($imul(46802, cr1)) >> 0;
		if (((((g >>> 0)) & 4278190080) >>> 0) === 0) {
			g = (g >> $min((8), 31)) >> 0;
		} else {
			g = (~((g >> 31 >> 0)) >> 0) & 65535;
		}
		b = yy1 + ($imul(116130, cb1)) >> 0;
		if (((((b >>> 0)) & 4278190080) >>> 0) === 0) {
			b = (b >> $min((8), 31)) >> 0;
		} else {
			b = (~((b >> 31 >> 0)) >> 0) & 65535;
		}
		return [((r >>> 0)), ((g >>> 0)), ((b >>> 0)), 65535];
	};
	YCbCr.prototype.RGBA = function() { return this.$val.RGBA(); };
	yCbCrModel = function(c) {
		var _r, _tuple, _tuple$1, _tuple$2, b, c, g, ok, r, u, v, x, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; b = $f.b; c = $f.c; g = $f.g; ok = $f.ok; r = $f.r; u = $f.u; v = $f.v; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, YCbCr, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		_tuple$2 = RGBToYCbCr((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)));
		y = _tuple$2[0];
		u = _tuple$2[1];
		v = _tuple$2[2];
		$s = -1; return (x = new YCbCr.ptr(y, u, v), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: yCbCrModel }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.b = b; $f.c = c; $f.g = g; $f.ok = ok; $f.r = r; $f.u = u; $f.v = v; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	NYCbCrA.ptr.prototype.RGBA = function() {
		var _q, _q$1, _q$2, a, b, c, cb1, cr1, g, r, yy1;
		c = this;
		yy1 = $imul(((c.YCbCr.Y >> 0)), 65793);
		cb1 = ((c.YCbCr.Cb >> 0)) - 128 >> 0;
		cr1 = ((c.YCbCr.Cr >> 0)) - 128 >> 0;
		r = yy1 + ($imul(91881, cr1)) >> 0;
		if (((((r >>> 0)) & 4278190080) >>> 0) === 0) {
			r = (r >> $min((8), 31)) >> 0;
		} else {
			r = (~((r >> 31 >> 0)) >> 0) & 65535;
		}
		g = (yy1 - ($imul(22554, cb1)) >> 0) - ($imul(46802, cr1)) >> 0;
		if (((((g >>> 0)) & 4278190080) >>> 0) === 0) {
			g = (g >> $min((8), 31)) >> 0;
		} else {
			g = (~((g >> 31 >> 0)) >> 0) & 65535;
		}
		b = yy1 + ($imul(116130, cb1)) >> 0;
		if (((((b >>> 0)) & 4278190080) >>> 0) === 0) {
			b = (b >> $min((8), 31)) >> 0;
		} else {
			b = (~((b >> 31 >> 0)) >> 0) & 65535;
		}
		a = $imul(((c.A >>> 0)), 257) >>> 0;
		return [(_q = ($imul(((r >>> 0)), a) >>> 0) / 65535, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero")), (_q$1 = ($imul(((g >>> 0)), a) >>> 0) / 65535, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero")), (_q$2 = ($imul(((b >>> 0)), a) >>> 0) / 65535, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero")), a];
	};
	NYCbCrA.prototype.RGBA = function() { return this.$val.RGBA(); };
	nYCbCrAModel = function(c) {
		var _q, _q$1, _q$2, _r, _ref, _tuple, _tuple$1, a, b, c, c$1, c$2, g, r, u, v, x, x$1, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _r = $f._r; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; a = $f.a; b = $f.b; c = $f.c; c$1 = $f.c$1; c$2 = $f.c$2; g = $f.g; r = $f.r; u = $f.u; v = $f.v; x = $f.x; x$1 = $f.x$1; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_ref = c;
		if ($assertType(_ref, NYCbCrA, true)[1]) {
			c$1 = $clone(_ref.$val, NYCbCrA);
			$s = -1; return new c$1.constructor.elem(c$1);
		} else if ($assertType(_ref, YCbCr, true)[1]) {
			c$2 = $clone(_ref.$val, YCbCr);
			$s = -1; return (x = new NYCbCrA.ptr($clone(c$2, YCbCr), 255), new x.constructor.elem(x));
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		g = _tuple[1];
		b = _tuple[2];
		a = _tuple[3];
		if (!((a === 0))) {
			r = (_q = (($imul(r, 65535) >>> 0)) / a, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			g = (_q$1 = (($imul(g, 65535) >>> 0)) / a, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
			b = (_q$2 = (($imul(b, 65535) >>> 0)) / a, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		_tuple$1 = RGBToYCbCr((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)));
		y = _tuple$1[0];
		u = _tuple$1[1];
		v = _tuple$1[2];
		$s = -1; return (x$1 = new NYCbCrA.ptr(new YCbCr.ptr(y, u, v), (((a >>> 8 >>> 0) << 24 >>> 24))), new x$1.constructor.elem(x$1));
		/* */ } return; } if ($f === undefined) { $f = { $blk: nYCbCrAModel }; } $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._r = _r; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.a = a; $f.b = b; $f.c = c; $f.c$1 = c$1; $f.c$2 = c$2; $f.g = g; $f.r = r; $f.u = u; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	RGBToCMYK = function(r, g, b) {
		var _q, _q$1, _q$2, b, bb, c, g, gg, m, r, rr, w, y;
		rr = ((r >>> 0));
		gg = ((g >>> 0));
		bb = ((b >>> 0));
		w = rr;
		if (w < gg) {
			w = gg;
		}
		if (w < bb) {
			w = bb;
		}
		if (w === 0) {
			return [0, 0, 0, 255];
		}
		c = (_q = ($imul(((w - rr >>> 0)), 255) >>> 0) / w, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		m = (_q$1 = ($imul(((w - gg >>> 0)), 255) >>> 0) / w, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		y = (_q$2 = ($imul(((w - bb >>> 0)), 255) >>> 0) / w, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		return [((c << 24 >>> 24)), ((m << 24 >>> 24)), ((y << 24 >>> 24)), (((255 - w >>> 0) << 24 >>> 24))];
	};
	$pkg.RGBToCMYK = RGBToCMYK;
	CMYK.ptr.prototype.RGBA = function() {
		var _q, _q$1, _q$2, b, c, g, r, w;
		c = this;
		w = 65535 - ($imul(((c.K >>> 0)), 257) >>> 0) >>> 0;
		r = (_q = ($imul(((65535 - ($imul(((c.C >>> 0)), 257) >>> 0) >>> 0)), w) >>> 0) / 65535, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		g = (_q$1 = ($imul(((65535 - ($imul(((c.M >>> 0)), 257) >>> 0) >>> 0)), w) >>> 0) / 65535, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
		b = (_q$2 = ($imul(((65535 - ($imul(((c.Y >>> 0)), 257) >>> 0) >>> 0)), w) >>> 0) / 65535, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >>> 0 : $throwRuntimeError("integer divide by zero"));
		return [r, g, b, 65535];
	};
	CMYK.prototype.RGBA = function() { return this.$val.RGBA(); };
	cmykModel = function(c) {
		var _r, _tuple, _tuple$1, _tuple$2, b, c, cc, g, kk, mm, ok, r, x, yy, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; b = $f.b; c = $f.c; cc = $f.cc; g = $f.g; kk = $f.kk; mm = $f.mm; ok = $f.ok; r = $f.r; x = $f.x; yy = $f.yy; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(c, CMYK, true);
		ok = _tuple[1];
		if (ok) {
			$s = -1; return c;
		}
		_r = c.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		r = _tuple$1[0];
		g = _tuple$1[1];
		b = _tuple$1[2];
		_tuple$2 = RGBToCMYK((((r >>> 8 >>> 0) << 24 >>> 24)), (((g >>> 8 >>> 0) << 24 >>> 24)), (((b >>> 8 >>> 0) << 24 >>> 24)));
		cc = _tuple$2[0];
		mm = _tuple$2[1];
		yy = _tuple$2[2];
		kk = _tuple$2[3];
		$s = -1; return (x = new CMYK.ptr(cc, mm, yy, kk), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: cmykModel }; } $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.b = b; $f.c = c; $f.cc = cc; $f.g = g; $f.kk = kk; $f.mm = mm; $f.ok = ok; $f.r = r; $f.x = x; $f.yy = yy; $f.$s = $s; $f.$r = $r; return $f;
	};
	RGBA.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	RGBA64.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	NRGBA.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	NRGBA64.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	Alpha.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	Alpha16.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	Gray.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	Gray16.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	ptrType.methods = [{prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Color], [Color], false)}];
	YCbCr.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	NYCbCrA.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	CMYK.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}];
	Color.init([{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}]);
	RGBA.init("", [{prop: "R", name: "R", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "G", name: "G", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "B", name: "B", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "A", name: "A", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	RGBA64.init("", [{prop: "R", name: "R", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "G", name: "G", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "B", name: "B", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "A", name: "A", embedded: false, exported: true, typ: $Uint16, tag: ""}]);
	NRGBA.init("", [{prop: "R", name: "R", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "G", name: "G", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "B", name: "B", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "A", name: "A", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	NRGBA64.init("", [{prop: "R", name: "R", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "G", name: "G", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "B", name: "B", embedded: false, exported: true, typ: $Uint16, tag: ""}, {prop: "A", name: "A", embedded: false, exported: true, typ: $Uint16, tag: ""}]);
	Alpha.init("", [{prop: "A", name: "A", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	Alpha16.init("", [{prop: "A", name: "A", embedded: false, exported: true, typ: $Uint16, tag: ""}]);
	Gray.init("", [{prop: "Y", name: "Y", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	Gray16.init("", [{prop: "Y", name: "Y", embedded: false, exported: true, typ: $Uint16, tag: ""}]);
	Model.init([{prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Color], [Color], false)}]);
	modelFunc.init("image/color", [{prop: "f", name: "f", embedded: false, exported: false, typ: funcType, tag: ""}]);
	YCbCr.init("", [{prop: "Y", name: "Y", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "Cb", name: "Cb", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "Cr", name: "Cr", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	NYCbCrA.init("", [{prop: "YCbCr", name: "YCbCr", embedded: true, exported: true, typ: YCbCr, tag: ""}, {prop: "A", name: "A", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	CMYK.init("", [{prop: "C", name: "C", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "M", name: "M", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "Y", name: "Y", embedded: false, exported: true, typ: $Uint8, tag: ""}, {prop: "K", name: "K", embedded: false, exported: true, typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$pkg.RGBAModel = ModelFunc(rgbaModel);
		$pkg.RGBA64Model = ModelFunc(rgba64Model);
		$pkg.NRGBAModel = ModelFunc(nrgbaModel);
		$pkg.NRGBA64Model = ModelFunc(nrgba64Model);
		$pkg.AlphaModel = ModelFunc(alphaModel);
		$pkg.Alpha16Model = ModelFunc(alpha16Model);
		$pkg.GrayModel = ModelFunc(grayModel);
		$pkg.Gray16Model = ModelFunc(gray16Model);
		$pkg.Black = new Gray16.ptr(0);
		$pkg.White = new Gray16.ptr(65535);
		$pkg.Transparent = new Alpha16.ptr(0);
		$pkg.Opaque = new Alpha16.ptr(65535);
		$pkg.YCbCrModel = ModelFunc(yCbCrModel);
		$pkg.NYCbCrAModel = ModelFunc(nYCbCrAModel);
		$pkg.CMYKModel = ModelFunc(cmykModel);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math/bits"] = (function() {
	var $pkg = {}, $init, deBruijn32tab, deBruijn64tab, TrailingZeros, TrailingZeros32, TrailingZeros64;
	TrailingZeros = function(x) {
		var x;
		if (true) {
			return TrailingZeros32(((x >>> 0)));
		}
		return TrailingZeros64((new $Uint64(0, x)));
	};
	$pkg.TrailingZeros = TrailingZeros;
	TrailingZeros32 = function(x) {
		var x, x$1;
		if (x === 0) {
			return 32;
		}
		return (((x$1 = ($imul((((x & (-x >>> 0)) >>> 0)), 125613361) >>> 0) >>> 27 >>> 0, ((x$1 < 0 || x$1 >= deBruijn32tab.length) ? ($throwRuntimeError("index out of range"), undefined) : deBruijn32tab[x$1])) >> 0));
	};
	$pkg.TrailingZeros32 = TrailingZeros32;
	TrailingZeros64 = function(x) {
		var x, x$1, x$2;
		if ((x.$high === 0 && x.$low === 0)) {
			return 64;
		}
		return (((x$1 = $shiftRightUint64($mul64(((x$2 = new $Uint64(-x.$high, -x.$low), new $Uint64(x.$high & x$2.$high, (x.$low & x$2.$low) >>> 0))), new $Uint64(66559345, 3033172745)), 58), (($flatten64(x$1) < 0 || $flatten64(x$1) >= deBruijn64tab.length) ? ($throwRuntimeError("index out of range"), undefined) : deBruijn64tab[$flatten64(x$1)])) >> 0));
	};
	$pkg.TrailingZeros64 = TrailingZeros64;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		deBruijn32tab = $toNativeArray($kindUint8, [0, 1, 28, 2, 29, 14, 24, 3, 30, 22, 20, 15, 25, 17, 4, 8, 31, 27, 13, 23, 21, 19, 16, 7, 26, 12, 18, 6, 11, 5, 10, 9]);
		deBruijn64tab = $toNativeArray($kindUint8, [0, 1, 56, 2, 57, 49, 28, 3, 61, 58, 42, 50, 38, 29, 17, 4, 62, 47, 59, 36, 45, 43, 51, 22, 53, 39, 33, 30, 24, 18, 12, 5, 63, 55, 48, 27, 60, 41, 37, 16, 46, 35, 44, 21, 52, 32, 23, 11, 54, 26, 40, 15, 34, 20, 31, 10, 25, 14, 19, 9, 13, 8, 7, 6]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, bits, arrayType, arrayType$1, arrayType$2, structType, math, buf, init;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	bits = $packages["math/bits"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType("math", [{prop: "uint32array", name: "uint32array", embedded: false, exported: false, typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", embedded: false, exported: false, typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", embedded: false, exported: false, typ: arrayType$2, tag: ""}]);
	init = function() {
		var ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bits.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		math = $global.Math;
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, bytealg, math, bits, utf8, sliceType$6, arrayType$3, FormatInt, Itoa, small, formatBits, isPowerOfTwo;
	errors = $packages["errors"];
	bytealg = $packages["internal/bytealg"];
	math = $packages["math"];
	bits = $packages["math/bits"];
	utf8 = $packages["unicode/utf8"];
	sliceType$6 = $sliceType($Uint8);
	arrayType$3 = $arrayType($Uint8, 65);
	FormatInt = function(i, base) {
		var _tuple, base, i, s;
		if (true && (0 < i.$high || (0 === i.$high && 0 <= i.$low)) && (i.$high < 0 || (i.$high === 0 && i.$low < 100)) && (base === 10)) {
			return small((((i.$low + ((i.$high >> 31) * 4294967296)) >> 0)));
		}
		_tuple = formatBits(sliceType$6.nil, (new $Uint64(i.$high, i.$low)), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var i;
		return FormatInt((new $Int64(0, i)), 10);
	};
	$pkg.Itoa = Itoa;
	small = function(i) {
		var i;
		if (i < 10) {
			return $substring("0123456789abcdefghijklmnopqrstuvwxyz", i, (i + 1 >> 0));
		}
		return $substring("00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899", ($imul(i, 2)), (($imul(i, 2)) + 2 >> 0));
	};
	formatBits = function(dst, u, base, neg, append_) {
		var _q, _q$1, _r, _r$1, a, append_, b, b$1, base, d, dst, i, is, is$1, is$2, j, m, neg, q, q$1, s, shift, u, us, us$1, x, x$1, x$2, x$3, x$4, x$5;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 1000000000)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = (((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0));
					j = 4;
					while (true) {
						if (!(j > 0)) { break; }
						is = (_r = us % 100, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) * 2 >>> 0;
						us = (_q = us / (100), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						i = i - (2) >> 0;
						(x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$1] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is + 1 >>> 0))));
						(x$2 = i + 0 >> 0, ((x$2 < 0 || x$2 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$2] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is + 0 >>> 0))));
						j = j - (1) >> 0;
					}
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt(((us * 2 >>> 0) + 1 >>> 0)));
					u = q;
				}
			}
			us$1 = ((u.$low >>> 0));
			while (true) {
				if (!(us$1 >= 100)) { break; }
				is$1 = (_r$1 = us$1 % 100, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) * 2 >>> 0;
				us$1 = (_q$1 = us$1 / (100), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				i = i - (2) >> 0;
				(x$3 = i + 1 >> 0, ((x$3 < 0 || x$3 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$3] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$1 + 1 >>> 0))));
				(x$4 = i + 0 >> 0, ((x$4 < 0 || x$4 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$4] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$1 + 0 >>> 0))));
			}
			is$2 = us$1 * 2 >>> 0;
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$2 + 1 >>> 0)));
			if (us$1 >= 10) {
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt(is$2));
			}
		} else if (isPowerOfTwo(base)) {
			shift = (((bits.TrailingZeros(((base >>> 0))) >>> 0)) & 7) >>> 0;
			b = (new $Uint64(0, base));
			m = ((base >>> 0)) - 1 >>> 0;
			while (true) {
				if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((((u.$low >>> 0)) & m) >>> 0)));
				u = $shiftRightUint64(u, (shift));
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((u.$low >>> 0))));
		} else {
			b$1 = (new $Uint64(0, base));
			while (true) {
				if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
				i = i - (1) >> 0;
				q$1 = $div64(u, b$1, false);
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((x$5 = $mul64(q$1, b$1), new $Uint64(u.$high - x$5.$high, u.$low - x$5.$low)).$low >>> 0))));
				u = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((u.$low >>> 0))));
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = ($bytesToString($subslice(new sliceType$6(a), i)));
		return [d, s];
	};
	isPowerOfTwo = function(x) {
		var x;
		return (x & ((x - 1 >> 0))) === 0;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bits.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["image"] = (function() {
	var $pkg = {}, $init, bufio, errors, color, io, strconv, sync, atomic, Point, Rectangle, Uniform, ptrType$10, x, x$1, x$2, x$3, Rect, NewUniform;
	bufio = $packages["bufio"];
	errors = $packages["errors"];
	color = $packages["image/color"];
	io = $packages["io"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	atomic = $packages["sync/atomic"];
	Point = $pkg.Point = $newType(0, $kindStruct, "image.Point", true, "image", true, function(X_, Y_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.X = 0;
			this.Y = 0;
			return;
		}
		this.X = X_;
		this.Y = Y_;
	});
	Rectangle = $pkg.Rectangle = $newType(0, $kindStruct, "image.Rectangle", true, "image", true, function(Min_, Max_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Min = new Point.ptr(0, 0);
			this.Max = new Point.ptr(0, 0);
			return;
		}
		this.Min = Min_;
		this.Max = Max_;
	});
	Uniform = $pkg.Uniform = $newType(0, $kindStruct, "image.Uniform", true, "image", true, function(C_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = $ifaceNil;
			return;
		}
		this.C = C_;
	});
	ptrType$10 = $ptrType(Uniform);
	Point.ptr.prototype.String = function() {
		var p;
		p = this;
		return "(" + strconv.Itoa(p.X) + "," + strconv.Itoa(p.Y) + ")";
	};
	Point.prototype.String = function() { return this.$val.String(); };
	Point.ptr.prototype.Add = function(q) {
		var p, q;
		p = this;
		return new Point.ptr(p.X + q.X >> 0, p.Y + q.Y >> 0);
	};
	Point.prototype.Add = function(q) { return this.$val.Add(q); };
	Point.ptr.prototype.Sub = function(q) {
		var p, q;
		p = this;
		return new Point.ptr(p.X - q.X >> 0, p.Y - q.Y >> 0);
	};
	Point.prototype.Sub = function(q) { return this.$val.Sub(q); };
	Point.ptr.prototype.Mul = function(k) {
		var k, p;
		p = this;
		return new Point.ptr($imul(p.X, k), $imul(p.Y, k));
	};
	Point.prototype.Mul = function(k) { return this.$val.Mul(k); };
	Point.ptr.prototype.Div = function(k) {
		var _q, _q$1, k, p;
		p = this;
		return new Point.ptr((_q = p.X / k, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")), (_q$1 = p.Y / k, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")));
	};
	Point.prototype.Div = function(k) { return this.$val.Div(k); };
	Point.ptr.prototype.In = function(r) {
		var p, r;
		p = this;
		return r.Min.X <= p.X && p.X < r.Max.X && r.Min.Y <= p.Y && p.Y < r.Max.Y;
	};
	Point.prototype.In = function(r) { return this.$val.In(r); };
	Point.ptr.prototype.Mod = function(r) {
		var _r, _r$1, _tmp, _tmp$1, h, p, r, w;
		p = this;
		_tmp = $clone(r, Rectangle).Dx();
		_tmp$1 = $clone(r, Rectangle).Dy();
		w = _tmp;
		h = _tmp$1;
		Point.copy(p, $clone(p, Point).Sub($clone(r.Min, Point)));
		p.X = (_r = p.X % w, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		if (p.X < 0) {
			p.X = p.X + (w) >> 0;
		}
		p.Y = (_r$1 = p.Y % h, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero"));
		if (p.Y < 0) {
			p.Y = p.Y + (h) >> 0;
		}
		return $clone(p, Point).Add($clone(r.Min, Point));
	};
	Point.prototype.Mod = function(r) { return this.$val.Mod(r); };
	Point.ptr.prototype.Eq = function(q) {
		var p, q;
		p = this;
		return $equal(p, q, Point);
	};
	Point.prototype.Eq = function(q) { return this.$val.Eq(q); };
	Rectangle.ptr.prototype.String = function() {
		var r;
		r = this;
		return $clone(r.Min, Point).String() + "-" + $clone(r.Max, Point).String();
	};
	Rectangle.prototype.String = function() { return this.$val.String(); };
	Rectangle.ptr.prototype.Dx = function() {
		var r;
		r = this;
		return r.Max.X - r.Min.X >> 0;
	};
	Rectangle.prototype.Dx = function() { return this.$val.Dx(); };
	Rectangle.ptr.prototype.Dy = function() {
		var r;
		r = this;
		return r.Max.Y - r.Min.Y >> 0;
	};
	Rectangle.prototype.Dy = function() { return this.$val.Dy(); };
	Rectangle.ptr.prototype.Size = function() {
		var r;
		r = this;
		return new Point.ptr(r.Max.X - r.Min.X >> 0, r.Max.Y - r.Min.Y >> 0);
	};
	Rectangle.prototype.Size = function() { return this.$val.Size(); };
	Rectangle.ptr.prototype.Add = function(p) {
		var p, r;
		r = this;
		return new Rectangle.ptr(new Point.ptr(r.Min.X + p.X >> 0, r.Min.Y + p.Y >> 0), new Point.ptr(r.Max.X + p.X >> 0, r.Max.Y + p.Y >> 0));
	};
	Rectangle.prototype.Add = function(p) { return this.$val.Add(p); };
	Rectangle.ptr.prototype.Sub = function(p) {
		var p, r;
		r = this;
		return new Rectangle.ptr(new Point.ptr(r.Min.X - p.X >> 0, r.Min.Y - p.Y >> 0), new Point.ptr(r.Max.X - p.X >> 0, r.Max.Y - p.Y >> 0));
	};
	Rectangle.prototype.Sub = function(p) { return this.$val.Sub(p); };
	Rectangle.ptr.prototype.Inset = function(n) {
		var _q, _q$1, n, r;
		r = this;
		if ($clone(r, Rectangle).Dx() < ($imul(2, n))) {
			r.Min.X = (_q = ((r.Min.X + r.Max.X >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			r.Max.X = r.Min.X;
		} else {
			r.Min.X = r.Min.X + (n) >> 0;
			r.Max.X = r.Max.X - (n) >> 0;
		}
		if ($clone(r, Rectangle).Dy() < ($imul(2, n))) {
			r.Min.Y = (_q$1 = ((r.Min.Y + r.Max.Y >> 0)) / 2, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			r.Max.Y = r.Min.Y;
		} else {
			r.Min.Y = r.Min.Y + (n) >> 0;
			r.Max.Y = r.Max.Y - (n) >> 0;
		}
		return r;
	};
	Rectangle.prototype.Inset = function(n) { return this.$val.Inset(n); };
	Rectangle.ptr.prototype.Intersect = function(s) {
		var r, s;
		r = this;
		if (r.Min.X < s.Min.X) {
			r.Min.X = s.Min.X;
		}
		if (r.Min.Y < s.Min.Y) {
			r.Min.Y = s.Min.Y;
		}
		if (r.Max.X > s.Max.X) {
			r.Max.X = s.Max.X;
		}
		if (r.Max.Y > s.Max.Y) {
			r.Max.Y = s.Max.Y;
		}
		if ($clone(r, Rectangle).Empty()) {
			return $pkg.ZR;
		}
		return r;
	};
	Rectangle.prototype.Intersect = function(s) { return this.$val.Intersect(s); };
	Rectangle.ptr.prototype.Union = function(s) {
		var r, s;
		r = this;
		if ($clone(r, Rectangle).Empty()) {
			return s;
		}
		if ($clone(s, Rectangle).Empty()) {
			return r;
		}
		if (r.Min.X > s.Min.X) {
			r.Min.X = s.Min.X;
		}
		if (r.Min.Y > s.Min.Y) {
			r.Min.Y = s.Min.Y;
		}
		if (r.Max.X < s.Max.X) {
			r.Max.X = s.Max.X;
		}
		if (r.Max.Y < s.Max.Y) {
			r.Max.Y = s.Max.Y;
		}
		return r;
	};
	Rectangle.prototype.Union = function(s) { return this.$val.Union(s); };
	Rectangle.ptr.prototype.Empty = function() {
		var r;
		r = this;
		return r.Min.X >= r.Max.X || r.Min.Y >= r.Max.Y;
	};
	Rectangle.prototype.Empty = function() { return this.$val.Empty(); };
	Rectangle.ptr.prototype.Eq = function(s) {
		var r, s;
		r = this;
		return $equal(r, s, Rectangle) || $clone(r, Rectangle).Empty() && $clone(s, Rectangle).Empty();
	};
	Rectangle.prototype.Eq = function(s) { return this.$val.Eq(s); };
	Rectangle.ptr.prototype.Overlaps = function(s) {
		var r, s;
		r = this;
		return !$clone(r, Rectangle).Empty() && !$clone(s, Rectangle).Empty() && r.Min.X < s.Max.X && s.Min.X < r.Max.X && r.Min.Y < s.Max.Y && s.Min.Y < r.Max.Y;
	};
	Rectangle.prototype.Overlaps = function(s) { return this.$val.Overlaps(s); };
	Rectangle.ptr.prototype.In = function(s) {
		var r, s;
		r = this;
		if ($clone(r, Rectangle).Empty()) {
			return true;
		}
		return s.Min.X <= r.Min.X && r.Max.X <= s.Max.X && s.Min.Y <= r.Min.Y && r.Max.Y <= s.Max.Y;
	};
	Rectangle.prototype.In = function(s) { return this.$val.In(s); };
	Rectangle.ptr.prototype.Canon = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, r;
		r = this;
		if (r.Max.X < r.Min.X) {
			_tmp = r.Max.X;
			_tmp$1 = r.Min.X;
			r.Min.X = _tmp;
			r.Max.X = _tmp$1;
		}
		if (r.Max.Y < r.Min.Y) {
			_tmp$2 = r.Max.Y;
			_tmp$3 = r.Min.Y;
			r.Min.Y = _tmp$2;
			r.Max.Y = _tmp$3;
		}
		return r;
	};
	Rectangle.prototype.Canon = function() { return this.$val.Canon(); };
	Rectangle.ptr.prototype.At = function(x$4, y) {
		var r, x$4, x$5, x$6, y;
		r = this;
		if ($clone((new Point.ptr(x$4, y)), Point).In($clone(r, Rectangle))) {
			return (x$5 = color.Opaque, new x$5.constructor.elem(x$5));
		}
		return (x$6 = color.Transparent, new x$6.constructor.elem(x$6));
	};
	Rectangle.prototype.At = function(x$4, y) { return this.$val.At(x$4, y); };
	Rectangle.ptr.prototype.Bounds = function() {
		var r;
		r = this;
		return r;
	};
	Rectangle.prototype.Bounds = function() { return this.$val.Bounds(); };
	Rectangle.ptr.prototype.ColorModel = function() {
		var r;
		r = this;
		return color.Alpha16Model;
	};
	Rectangle.prototype.ColorModel = function() { return this.$val.ColorModel(); };
	Rect = function(x0, y0, x1, y1) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, x0, x1, y0, y1;
		if (x0 > x1) {
			_tmp = x1;
			_tmp$1 = x0;
			x0 = _tmp;
			x1 = _tmp$1;
		}
		if (y0 > y1) {
			_tmp$2 = y1;
			_tmp$3 = y0;
			y0 = _tmp$2;
			y1 = _tmp$3;
		}
		return new Rectangle.ptr(new Point.ptr(x0, y0), new Point.ptr(x1, y1));
	};
	$pkg.Rect = Rect;
	Uniform.ptr.prototype.RGBA = function() {
		var _r, _tuple, a, b, c, g, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; a = $f.a; b = $f.b; c = $f.c; g = $f.g; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		g = 0;
		b = 0;
		a = 0;
		c = this;
		_r = c.C.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		g = _tuple[1];
		b = _tuple[2];
		a = _tuple[3];
		$s = -1; return [r, g, b, a];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Uniform.ptr.prototype.RGBA }; } $f._r = _r; $f._tuple = _tuple; $f.a = a; $f.b = b; $f.c = c; $f.g = g; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Uniform.prototype.RGBA = function() { return this.$val.RGBA(); };
	Uniform.ptr.prototype.ColorModel = function() {
		var c;
		c = this;
		return c;
	};
	Uniform.prototype.ColorModel = function() { return this.$val.ColorModel(); };
	Uniform.ptr.prototype.Convert = function(param) {
		var c, param;
		c = this;
		return c.C;
	};
	Uniform.prototype.Convert = function(param) { return this.$val.Convert(param); };
	Uniform.ptr.prototype.Bounds = function() {
		var c;
		c = this;
		return new Rectangle.ptr(new Point.ptr(-1000000000, -1000000000), new Point.ptr(1000000000, 1000000000));
	};
	Uniform.prototype.Bounds = function() { return this.$val.Bounds(); };
	Uniform.ptr.prototype.At = function(x$4, y) {
		var c, x$4, y;
		c = this;
		return c.C;
	};
	Uniform.prototype.At = function(x$4, y) { return this.$val.At(x$4, y); };
	Uniform.ptr.prototype.Opaque = function() {
		var _r, _tuple, a, c, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; a = $f.a; c = $f.c; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = this;
		_r = c.C.RGBA(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		a = _tuple[3];
		$s = -1; return a === 65535;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Uniform.ptr.prototype.Opaque }; } $f._r = _r; $f._tuple = _tuple; $f.a = a; $f.c = c; $f.$s = $s; $f.$r = $r; return $f;
	};
	Uniform.prototype.Opaque = function() { return this.$val.Opaque(); };
	NewUniform = function(c) {
		var c;
		return new Uniform.ptr(c);
	};
	$pkg.NewUniform = NewUniform;
	Point.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Point], [Point], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Point], [Point], false)}, {prop: "Mul", name: "Mul", pkg: "", typ: $funcType([$Int], [Point], false)}, {prop: "Div", name: "Div", pkg: "", typ: $funcType([$Int], [Point], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([Rectangle], [$Bool], false)}, {prop: "Mod", name: "Mod", pkg: "", typ: $funcType([Rectangle], [Point], false)}, {prop: "Eq", name: "Eq", pkg: "", typ: $funcType([Point], [$Bool], false)}];
	Rectangle.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Dx", name: "Dx", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Dy", name: "Dy", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [Point], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Point], [Rectangle], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Point], [Rectangle], false)}, {prop: "Inset", name: "Inset", pkg: "", typ: $funcType([$Int], [Rectangle], false)}, {prop: "Intersect", name: "Intersect", pkg: "", typ: $funcType([Rectangle], [Rectangle], false)}, {prop: "Union", name: "Union", pkg: "", typ: $funcType([Rectangle], [Rectangle], false)}, {prop: "Empty", name: "Empty", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Eq", name: "Eq", pkg: "", typ: $funcType([Rectangle], [$Bool], false)}, {prop: "Overlaps", name: "Overlaps", pkg: "", typ: $funcType([Rectangle], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([Rectangle], [$Bool], false)}, {prop: "Canon", name: "Canon", pkg: "", typ: $funcType([], [Rectangle], false)}, {prop: "At", name: "At", pkg: "", typ: $funcType([$Int, $Int], [color.Color], false)}, {prop: "Bounds", name: "Bounds", pkg: "", typ: $funcType([], [Rectangle], false)}, {prop: "ColorModel", name: "ColorModel", pkg: "", typ: $funcType([], [color.Model], false)}];
	ptrType$10.methods = [{prop: "RGBA", name: "RGBA", pkg: "", typ: $funcType([], [$Uint32, $Uint32, $Uint32, $Uint32], false)}, {prop: "ColorModel", name: "ColorModel", pkg: "", typ: $funcType([], [color.Model], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([color.Color], [color.Color], false)}, {prop: "Bounds", name: "Bounds", pkg: "", typ: $funcType([], [Rectangle], false)}, {prop: "At", name: "At", pkg: "", typ: $funcType([$Int, $Int], [color.Color], false)}, {prop: "Opaque", name: "Opaque", pkg: "", typ: $funcType([], [$Bool], false)}];
	Point.init("", [{prop: "X", name: "X", embedded: false, exported: true, typ: $Int, tag: ""}, {prop: "Y", name: "Y", embedded: false, exported: true, typ: $Int, tag: ""}]);
	Rectangle.init("", [{prop: "Min", name: "Min", embedded: false, exported: true, typ: Point, tag: ""}, {prop: "Max", name: "Max", embedded: false, exported: true, typ: Point, tag: ""}]);
	Uniform.init("", [{prop: "C", name: "C", embedded: false, exported: true, typ: color.Color, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bufio.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = errors.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = color.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ZR = new Rectangle.ptr(new Point.ptr(0, 0), new Point.ptr(0, 0));
		$pkg.ErrFormat = errors.New("image: unknown format");
		$pkg.Black = NewUniform((x = color.Black, new x.constructor.elem(x)));
		$pkg.White = NewUniform((x$1 = color.White, new x$1.constructor.elem(x$1)));
		$pkg.Transparent = NewUniform((x$2 = color.Transparent, new x$2.constructor.elem(x$2)));
		$pkg.Opaque = NewUniform((x$3 = color.Opaque, new x$3.constructor.elem(x$3)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, bytealg, io, sync, unicode, utf8, Builder, ptrType, sliceType, Join;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	bytealg = $packages["internal/bytealg"];
	io = $packages["io"];
	sync = $packages["sync"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Builder = $pkg.Builder = $newType(0, $kindStruct, "strings.Builder", true, "strings", true, function(addr_, buf_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.addr = ptrType.nil;
			this.buf = sliceType.nil;
			return;
		}
		this.addr = addr_;
		this.buf = buf_;
	});
	ptrType = $ptrType(Builder);
	sliceType = $sliceType($Uint8);
	Builder.ptr.prototype.String = function() {
		var b;
		b = this;
		return ($bytesToString(b.buf));
	};
	Builder.prototype.String = function() { return this.$val.String(); };
	Builder.ptr.prototype.copyCheck = function() {
		var b;
		b = this;
		if (b.addr === ptrType.nil) {
			b.addr = b;
		} else if (!(b.addr === b)) {
			$panic(new $String("strings: illegal use of non-zero Builder copied by value"));
		}
	};
	Builder.prototype.copyCheck = function() { return this.$val.copyCheck(); };
	Builder.ptr.prototype.Len = function() {
		var b;
		b = this;
		return b.buf.$length;
	};
	Builder.prototype.Len = function() { return this.$val.Len(); };
	Builder.ptr.prototype.Cap = function() {
		var b;
		b = this;
		return b.buf.$capacity;
	};
	Builder.prototype.Cap = function() { return this.$val.Cap(); };
	Builder.ptr.prototype.Reset = function() {
		var b;
		b = this;
		b.addr = ptrType.nil;
		b.buf = sliceType.nil;
	};
	Builder.prototype.Reset = function() { return this.$val.Reset(); };
	Builder.ptr.prototype.grow = function(n) {
		var b, buf, n;
		b = this;
		buf = $makeSlice(sliceType, b.buf.$length, (($imul(2, b.buf.$capacity)) + n >> 0));
		$copySlice(buf, b.buf);
		b.buf = buf;
	};
	Builder.prototype.grow = function(n) { return this.$val.grow(n); };
	Builder.ptr.prototype.Grow = function(n) {
		var b, n;
		b = this;
		b.copyCheck();
		if (n < 0) {
			$panic(new $String("strings.Builder.Grow: negative count"));
		}
		if ((b.buf.$capacity - b.buf.$length >> 0) < n) {
			b.grow(n);
		}
	};
	Builder.prototype.Grow = function(n) { return this.$val.Grow(n); };
	Builder.ptr.prototype.Write = function(p) {
		var b, p;
		b = this;
		b.copyCheck();
		b.buf = $appendSlice(b.buf, p);
		return [p.$length, $ifaceNil];
	};
	Builder.prototype.Write = function(p) { return this.$val.Write(p); };
	Builder.ptr.prototype.WriteByte = function(c) {
		var b, c;
		b = this;
		b.copyCheck();
		b.buf = $append(b.buf, c);
		return $ifaceNil;
	};
	Builder.prototype.WriteByte = function(c) { return this.$val.WriteByte(c); };
	Builder.ptr.prototype.WriteRune = function(r) {
		var b, l, n, r;
		b = this;
		b.copyCheck();
		if (r < 128) {
			b.buf = $append(b.buf, ((r << 24 >>> 24)));
			return [1, $ifaceNil];
		}
		l = b.buf.$length;
		if ((b.buf.$capacity - l >> 0) < 4) {
			b.grow(4);
		}
		n = utf8.EncodeRune($subslice(b.buf, l, (l + 4 >> 0)), r);
		b.buf = $subslice(b.buf, 0, (l + n >> 0));
		return [n, $ifaceNil];
	};
	Builder.prototype.WriteRune = function(r) { return this.$val.WriteRune(r); };
	Builder.ptr.prototype.WriteString = function(s) {
		var b, s;
		b = this;
		b.copyCheck();
		b.buf = $appendSlice(b.buf, s);
		return [s.length, $ifaceNil];
	};
	Builder.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	Join = function(a, sep) {
		var _1, _i, _ref, a, b, i, n, s, sep;
		_1 = a.$length;
		if (_1 === (0)) {
			return "";
		} else if (_1 === (1)) {
			return (0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]);
		}
		n = $imul(sep.length, ((a.$length - 1 >> 0)));
		i = 0;
		while (true) {
			if (!(i < a.$length)) { break; }
			n = n + (((i < 0 || i >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + i]).length) >> 0;
			i = i + (1) >> 0;
		}
		b = new Builder.ptr(ptrType.nil, sliceType.nil);
		b.Grow(n);
		b.WriteString((0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]));
		_ref = $subslice(a, 1);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			b.WriteString(sep);
			b.WriteString(s);
			_i++;
		}
		return b.String();
	};
	$pkg.Join = Join;
	ptrType.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "copyCheck", name: "copyCheck", pkg: "strings", typ: $funcType([], [], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "grow", name: "grow", pkg: "strings", typ: $funcType([$Int], [], false)}, {prop: "Grow", name: "Grow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [$error], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}];
	Builder.init("strings", [{prop: "addr", name: "addr", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "buf", name: "buf", embedded: false, exported: false, typ: sliceType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytealg.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Once, funcType$1, ptrType$4;
	Once = $pkg.Once = $newType(0, $kindStruct, "nosync.Once", true, "github.com/gopherjs/gopherjs/nosync", true, function(doing_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.doing = false;
			this.done = false;
			return;
		}
		this.doing = doing_;
		this.done = done_;
	});
	funcType$1 = $funcType([], [], false);
	ptrType$4 = $ptrType(Once);
	Once.ptr.prototype.Do = function(f) {
		var f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = [o];
		o[0] = this;
		if (o[0].done) {
			$s = -1; return;
		}
		if (o[0].doing) {
			$panic(new $String("nosync: Do called within f"));
		}
		o[0].doing = true;
		$deferred.push([(function(o) { return function() {
			o[0].doing = false;
			o[0].done = true;
		}; })(o), []]);
		$r = f(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	ptrType$4.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$1], [], false)}];
	Once.init("github.com/gopherjs/gopherjs/nosync", [{prop: "doing", name: "doing", embedded: false, exported: false, typ: $Bool, tag: ""}, {prop: "done", name: "done", embedded: false, exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["syscall"] = (function() {
	var $pkg = {}, $init, js, race, runtime, sync, mmapper, Errno, sliceType, sliceType$1, ptrType$2, arrayType$4, structType, ptrType$26, mapType, funcType$2, funcType$3, warningPrinted, lineBuffer, syscallModule, alreadyTriedToLoad, minusOne, envs, mapper, errEAGAIN, errEINVAL, errENOENT, errors, init, printWarning, printToConsole, indexByte, runtime_envs, syscallByName, Syscall, Syscall6, itoa, uitoa, errnoErr, munmap, mmap;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	mmapper = $pkg.mmapper = $newType(0, $kindStruct, "syscall.mmapper", true, "syscall", false, function(Mutex_, active_, mmap_, munmap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Mutex = new sync.Mutex.ptr(0, 0);
			this.active = false;
			this.mmap = $throwNilPointerError;
			this.munmap = $throwNilPointerError;
			return;
		}
		this.Mutex = Mutex_;
		this.active = active_;
		this.mmap = mmap_;
		this.munmap = munmap_;
	});
	Errno = $pkg.Errno = $newType(4, $kindUintptr, "syscall.Errno", true, "syscall", true, null);
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	ptrType$2 = $ptrType($Uint8);
	arrayType$4 = $arrayType($Uint8, 32);
	structType = $structType("syscall", [{prop: "addr", name: "addr", embedded: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "len", name: "len", embedded: false, exported: false, typ: $Int, tag: ""}, {prop: "cap", name: "cap", embedded: false, exported: false, typ: $Int, tag: ""}]);
	ptrType$26 = $ptrType(mmapper);
	mapType = $mapType(ptrType$2, sliceType);
	funcType$2 = $funcType([$Uintptr, $Uintptr, $Int, $Int, $Int, $Int64], [$Uintptr, $error], false);
	funcType$3 = $funcType([$Uintptr, $Uintptr], [$error], false);
	init = function() {
		$flushConsole = (function() {
			if (!((lineBuffer.$length === 0))) {
				$global.console.log($externalize(($bytesToString(lineBuffer)), $String));
				lineBuffer = sliceType.nil;
			}
		});
	};
	printWarning = function() {
		if (!warningPrinted) {
			$global.console.error($externalize("warning: system calls not available, see https://github.com/gopherjs/gopherjs/blob/master/doc/syscalls.md", $String));
		}
		warningPrinted = true;
	};
	printToConsole = function(b) {
		var b, goPrintToConsole, i;
		goPrintToConsole = $global.goPrintToConsole;
		if (!(goPrintToConsole === undefined)) {
			goPrintToConsole(b);
			return;
		}
		lineBuffer = $appendSlice(lineBuffer, b);
		while (true) {
			i = indexByte(lineBuffer, 10);
			if (i === -1) {
				break;
			}
			$global.console.log($externalize(($bytesToString($subslice(lineBuffer, 0, i))), $String));
			lineBuffer = $subslice(lineBuffer, (i + 1 >> 0));
		}
	};
	indexByte = function(s, c) {
		var _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	runtime_envs = function() {
		var envkeys, envs$1, i, jsEnv, key, process;
		process = $global.process;
		if (process === undefined) {
			return sliceType$1.nil;
		}
		jsEnv = process.env;
		envkeys = $global.Object.keys(jsEnv);
		envs$1 = $makeSlice(sliceType$1, $parseInt(envkeys.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(envkeys.length))) { break; }
			key = $internalize(envkeys[i], $String);
			((i < 0 || i >= envs$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : envs$1.$array[envs$1.$offset + i] = key + "=" + $internalize(jsEnv[$externalize(key, $String)], $String));
			i = i + (1) >> 0;
		}
		return envs$1;
	};
	syscallByName = function(name) {
		var name, require, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			$recover();
		}), []]);
		if (syscallModule === null) {
			if (alreadyTriedToLoad) {
				return null;
			}
			alreadyTriedToLoad = true;
			require = $global.require;
			if (require === undefined) {
				$panic(new $String(""));
			}
			syscallModule = require($externalize("syscall", $String));
		}
		return syscallModule[$externalize(name, $String)];
		/* */ } catch(err) { $err = err; return null; } finally { $callDeferred($deferred, $err); }
	};
	Syscall = function(trap, a1, a2, a3) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, a1, a2, a3, array, err, f, r, r1, r2, slice, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscallByName("Syscall");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3);
			_tmp = ((($parseInt(r[0]) >> 0) >>> 0));
			_tmp$1 = ((($parseInt(r[1]) >> 0) >>> 0));
			_tmp$2 = ((($parseInt(r[2]) >> 0) >>> 0));
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if ((trap === 1) && ((a1 === 1) || (a1 === 2))) {
			array = a2;
			slice = $makeSlice(sliceType, $parseInt(array.length));
			slice.$array = array;
			printToConsole(slice);
			_tmp$3 = (($parseInt(array.length) >>> 0));
			_tmp$4 = 0;
			_tmp$5 = 0;
			r1 = _tmp$3;
			r2 = _tmp$4;
			err = _tmp$5;
			return [r1, r2, err];
		}
		if (trap === 231) {
			runtime.Goexit();
		}
		printWarning();
		_tmp$6 = ((minusOne >>> 0));
		_tmp$7 = 0;
		_tmp$8 = 13;
		r1 = _tmp$6;
		r2 = _tmp$7;
		err = _tmp$8;
		return [r1, r2, err];
	};
	$pkg.Syscall = Syscall;
	Syscall6 = function(trap, a1, a2, a3, a4, a5, a6) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, a1, a2, a3, a4, a5, a6, err, f, r, r1, r2, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscallByName("Syscall6");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3, a4, a5, a6);
			_tmp = ((($parseInt(r[0]) >> 0) >>> 0));
			_tmp$1 = ((($parseInt(r[1]) >> 0) >>> 0));
			_tmp$2 = ((($parseInt(r[2]) >> 0) >>> 0));
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if (!((trap === 202))) {
			printWarning();
		}
		_tmp$3 = ((minusOne >>> 0));
		_tmp$4 = 0;
		_tmp$5 = 13;
		r1 = _tmp$3;
		r2 = _tmp$4;
		err = _tmp$5;
		return [r1, r2, err];
	};
	$pkg.Syscall6 = Syscall6;
	itoa = function(val) {
		var val;
		if (val < 0) {
			return "-" + uitoa(((-val >>> 0)));
		}
		return uitoa(((val >>> 0)));
	};
	uitoa = function(val) {
		var _q, _r, buf, i, val;
		buf = arrayType$4.zero();
		i = 31;
		while (true) {
			if (!(val >= 10)) { break; }
			((i < 0 || i >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[i] = ((((_r = val % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24)));
			i = i - (1) >> 0;
			val = (_q = val / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		((i < 0 || i >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[i] = (((val + 48 >>> 0) << 24 >>> 24)));
		return ($bytesToString($subslice(new sliceType(buf), i)));
	};
	mmapper.ptr.prototype.Mmap = function(fd, offset, length, prot, flags) {
		var _key, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, addr, b, data, err, errno, fd, flags, length, m, offset, p, prot, sl, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _key = $f._key; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; addr = $f.addr; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; fd = $f.fd; flags = $f.flags; length = $f.length; m = $f.m; offset = $f.offset; p = $f.p; prot = $f.prot; sl = $f.sl; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		sl = [sl];
		data = sliceType.nil;
		err = $ifaceNil;
		m = this;
		if (length <= 0) {
			_tmp = sliceType.nil;
			_tmp$1 = new Errno(22);
			data = _tmp;
			err = _tmp$1;
			$s = -1; return [data, err];
		}
		_r = m.mmap(0, ((length >>> 0)), prot, flags, fd, offset); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		addr = _tuple[0];
		errno = _tuple[1];
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = errno;
			data = _tmp$2;
			err = _tmp$3;
			$s = -1; return [data, err];
		}
		sl[0] = new structType.ptr(addr, length, length);
		b = sl[0];
		p = $indexPtr(b.$array, b.$offset + (b.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		_key = p; (m.active || $throwRuntimeError("assignment to entry in nil map"))[ptrType$2.keyFor(_key)] = { k: _key, v: b };
		_tmp$4 = b;
		_tmp$5 = $ifaceNil;
		data = _tmp$4;
		err = _tmp$5;
		$s = -1; return [data, err];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Mmap }; } $f._key = _key; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.addr = addr; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.fd = fd; $f.flags = flags; $f.length = length; $f.m = m; $f.offset = offset; $f.p = p; $f.prot = prot; $f.sl = sl; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Mmap = function(fd, offset, length, prot, flags) { return this.$val.Mmap(fd, offset, length, prot, flags); };
	mmapper.ptr.prototype.Munmap = function(data) {
		var _entry, _r, b, data, err, errno, m, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _r = $f._r; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; m = $f.m; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		m = this;
		if ((data.$length === 0) || !((data.$length === data.$capacity))) {
			err = new Errno(22);
			$s = -1; return err;
		}
		p = $indexPtr(data.$array, data.$offset + (data.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		b = (_entry = m.active[ptrType$2.keyFor(p)], _entry !== undefined ? _entry.v : sliceType.nil);
		if (b === sliceType.nil || !($indexPtr(b.$array, b.$offset + 0, ptrType$2) === $indexPtr(data.$array, data.$offset + 0, ptrType$2))) {
			err = new Errno(22);
			$s = -1; return err;
		}
		_r = m.munmap((($sliceToArray(b))), ((b.$length >>> 0))); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		errno = _r;
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			err = errno;
			$s = -1; return err;
		}
		delete m.active[ptrType$2.keyFor(p)];
		err = $ifaceNil;
		$s = -1; return err;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Munmap }; } $f._entry = _entry; $f._r = _r; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.m = m; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Munmap = function(data) { return this.$val.Munmap(data); };
	Errno.prototype.Error = function() {
		var e, s;
		e = this.$val;
		if (0 <= ((e >> 0)) && ((e >> 0)) < 133) {
			s = ((e < 0 || e >= errors.length) ? ($throwRuntimeError("index out of range"), undefined) : errors[e]);
			if (!(s === "")) {
				return s;
			}
		}
		return "errno " + itoa(((e >> 0)));
	};
	$ptrType(Errno).prototype.Error = function() { return new Errno(this.$get()).Error(); };
	Errno.prototype.Temporary = function() {
		var e;
		e = this.$val;
		return (e === 4) || (e === 24) || new Errno(e).Timeout();
	};
	$ptrType(Errno).prototype.Temporary = function() { return new Errno(this.$get()).Temporary(); };
	Errno.prototype.Timeout = function() {
		var e;
		e = this.$val;
		return (e === 11) || (e === 11) || (e === 110);
	};
	$ptrType(Errno).prototype.Timeout = function() { return new Errno(this.$get()).Timeout(); };
	errnoErr = function(e) {
		var _1, e;
		_1 = e;
		if (_1 === (0)) {
			return $ifaceNil;
		} else if (_1 === (11)) {
			return errEAGAIN;
		} else if (_1 === (22)) {
			return errEINVAL;
		} else if (_1 === (2)) {
			return errENOENT;
		}
		return new Errno(e);
	};
	munmap = function(addr, length) {
		var _tuple, addr, e1, err, length;
		err = $ifaceNil;
		_tuple = Syscall(11, (addr), (length), 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	mmap = function(addr, length, prot, flags, fd, offset) {
		var _tuple, addr, e1, err, fd, flags, length, offset, prot, r0, xaddr;
		xaddr = 0;
		err = $ifaceNil;
		_tuple = Syscall6(9, (addr), (length), ((prot >>> 0)), ((flags >>> 0)), ((fd >>> 0)), ((offset.$low >>> 0)));
		r0 = _tuple[0];
		e1 = _tuple[2];
		xaddr = (r0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [xaddr, err];
	};
	ptrType$26.methods = [{prop: "Mmap", name: "Mmap", pkg: "", typ: $funcType([$Int, $Int64, $Int, $Int, $Int], [sliceType, $error], false)}, {prop: "Munmap", name: "Munmap", pkg: "", typ: $funcType([sliceType], [$error], false)}];
	Errno.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Temporary", name: "Temporary", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $funcType([], [$Bool], false)}];
	mmapper.init("syscall", [{prop: "Mutex", name: "Mutex", embedded: true, exported: true, typ: sync.Mutex, tag: ""}, {prop: "active", name: "active", embedded: false, exported: false, typ: mapType, tag: ""}, {prop: "mmap", name: "mmap", embedded: false, exported: false, typ: funcType$2, tag: ""}, {prop: "munmap", name: "munmap", embedded: false, exported: false, typ: funcType$3, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		lineBuffer = sliceType.nil;
		syscallModule = null;
		warningPrinted = false;
		alreadyTriedToLoad = false;
		minusOne = -1;
		envs = runtime_envs();
		errEAGAIN = new Errno(11);
		errEINVAL = new Errno(22);
		errENOENT = new Errno(2);
		errors = $toNativeArray($kindString, ["", "operation not permitted", "no such file or directory", "no such process", "interrupted system call", "input/output error", "no such device or address", "argument list too long", "exec format error", "bad file descriptor", "no child processes", "resource temporarily unavailable", "cannot allocate memory", "permission denied", "bad address", "block device required", "device or resource busy", "file exists", "invalid cross-device link", "no such device", "not a directory", "is a directory", "invalid argument", "too many open files in system", "too many open files", "inappropriate ioctl for device", "text file busy", "file too large", "no space left on device", "illegal seek", "read-only file system", "too many links", "broken pipe", "numerical argument out of domain", "numerical result out of range", "resource deadlock avoided", "file name too long", "no locks available", "function not implemented", "directory not empty", "too many levels of symbolic links", "", "no message of desired type", "identifier removed", "channel number out of range", "level 2 not synchronized", "level 3 halted", "level 3 reset", "link number out of range", "protocol driver not attached", "no CSI structure available", "level 2 halted", "invalid exchange", "invalid request descriptor", "exchange full", "no anode", "invalid request code", "invalid slot", "", "bad font file format", "device not a stream", "no data available", "timer expired", "out of streams resources", "machine is not on the network", "package not installed", "object is remote", "link has been severed", "advertise error", "srmount error", "communication error on send", "protocol error", "multihop attempted", "RFS specific error", "bad message", "value too large for defined data type", "name not unique on network", "file descriptor in bad state", "remote address changed", "can not access a needed shared library", "accessing a corrupted shared library", ".lib section in a.out corrupted", "attempting to link in too many shared libraries", "cannot exec a shared library directly", "invalid or incomplete multibyte or wide character", "interrupted system call should be restarted", "streams pipe error", "too many users", "socket operation on non-socket", "destination address required", "message too long", "protocol wrong type for socket", "protocol not available", "protocol not supported", "socket type not supported", "operation not supported", "protocol family not supported", "address family not supported by protocol", "address already in use", "cannot assign requested address", "network is down", "network is unreachable", "network dropped connection on reset", "software caused connection abort", "connection reset by peer", "no buffer space available", "transport endpoint is already connected", "transport endpoint is not connected", "cannot send after transport endpoint shutdown", "too many references: cannot splice", "connection timed out", "connection refused", "host is down", "no route to host", "operation already in progress", "operation now in progress", "stale NFS file handle", "structure needs cleaning", "not a XENIX named type file", "no XENIX semaphores available", "is a named type file", "remote I/O error", "disk quota exceeded", "no medium found", "wrong medium type", "operation canceled", "required key not available", "key has expired", "key has been revoked", "key was rejected by service", "owner died", "state not recoverable", "operation not possible due to RF-kill"]);
		mapper = new mmapper.ptr(new sync.Mutex.ptr(0, 0), {}, mmap, munmap);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["time"] = (function() {
	var $pkg = {}, $init, errors, js, nosync, runtime, syscall, ParseError, Time, Month, Weekday, Duration, Location, zone, zoneTrans, sliceType, sliceType$1, ptrType, sliceType$2, arrayType, sliceType$3, arrayType$1, arrayType$2, ptrType$2, arrayType$3, ptrType$4, ptrType$7, zoneSources, std0x, longDayNames, shortDayNames, shortMonthNames, longMonthNames, atoiError, errBad, errLeadingInt, months, days, daysBefore, startNano, utcLoc, utcLoc$24ptr, localLoc, localLoc$24ptr, localOnce, errLocation, badData, x, init, initLocal, runtimeNano, indexByte, startsWithLowerCase, nextStdChunk, match, lookup, appendInt, atoi, formatNano, quote, isDigit, getnum, cutspace, skip, Parse, parse, parseTimeZone, parseGMT, parseSignedOffset, parseNanoseconds, leadingInt, absWeekday, absClock, fmtFrac, fmtInt, lessThanHalf, absDate, daysIn, unixTime, Unix, isLeap, norm, Date, div, FixedZone;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	runtime = $packages["runtime"];
	syscall = $packages["syscall"];
	ParseError = $pkg.ParseError = $newType(0, $kindStruct, "time.ParseError", true, "time", true, function(Layout_, Value_, LayoutElem_, ValueElem_, Message_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Layout = "";
			this.Value = "";
			this.LayoutElem = "";
			this.ValueElem = "";
			this.Message = "";
			return;
		}
		this.Layout = Layout_;
		this.Value = Value_;
		this.LayoutElem = LayoutElem_;
		this.ValueElem = ValueElem_;
		this.Message = Message_;
	});
	Time = $pkg.Time = $newType(0, $kindStruct, "time.Time", true, "time", true, function(wall_, ext_, loc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wall = new $Uint64(0, 0);
			this.ext = new $Int64(0, 0);
			this.loc = ptrType$2.nil;
			return;
		}
		this.wall = wall_;
		this.ext = ext_;
		this.loc = loc_;
	});
	Month = $pkg.Month = $newType(4, $kindInt, "time.Month", true, "time", true, null);
	Weekday = $pkg.Weekday = $newType(4, $kindInt, "time.Weekday", true, "time", true, null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "time.Duration", true, "time", true, null);
	Location = $pkg.Location = $newType(0, $kindStruct, "time.Location", true, "time", true, function(name_, zone_, tx_, cacheStart_, cacheEnd_, cacheZone_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.zone = sliceType.nil;
			this.tx = sliceType$1.nil;
			this.cacheStart = new $Int64(0, 0);
			this.cacheEnd = new $Int64(0, 0);
			this.cacheZone = ptrType.nil;
			return;
		}
		this.name = name_;
		this.zone = zone_;
		this.tx = tx_;
		this.cacheStart = cacheStart_;
		this.cacheEnd = cacheEnd_;
		this.cacheZone = cacheZone_;
	});
	zone = $pkg.zone = $newType(0, $kindStruct, "time.zone", true, "time", false, function(name_, offset_, isDST_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.offset = 0;
			this.isDST = false;
			return;
		}
		this.name = name_;
		this.offset = offset_;
		this.isDST = isDST_;
	});
	zoneTrans = $pkg.zoneTrans = $newType(0, $kindStruct, "time.zoneTrans", true, "time", false, function(when_, index_, isstd_, isutc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.when = new $Int64(0, 0);
			this.index = 0;
			this.isstd = false;
			this.isutc = false;
			return;
		}
		this.when = when_;
		this.index = index_;
		this.isstd = isstd_;
		this.isutc = isutc_;
	});
	sliceType = $sliceType(zone);
	sliceType$1 = $sliceType(zoneTrans);
	ptrType = $ptrType(zone);
	sliceType$2 = $sliceType($String);
	arrayType = $arrayType($Uint8, 20);
	sliceType$3 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 9);
	arrayType$2 = $arrayType($Uint8, 64);
	ptrType$2 = $ptrType(Location);
	arrayType$3 = $arrayType($Uint8, 32);
	ptrType$4 = $ptrType(ParseError);
	ptrType$7 = $ptrType(Time);
	init = function() {
		$unused(Unix(new $Int64(0, 0), new $Int64(0, 0)));
	};
	initLocal = function() {
		var d, i, j, s;
		d = new ($global.Date)();
		s = $internalize(d, $String);
		i = indexByte(s, 40);
		j = indexByte(s, 41);
		if ((i === -1) || (j === -1)) {
			localLoc.name = "UTC";
			return;
		}
		localLoc.name = $substring(s, (i + 1 >> 0), j);
		localLoc.zone = new sliceType([new zone.ptr(localLoc.name, $imul(($parseInt(d.getTimezoneOffset()) >> 0), -60), false)]);
	};
	runtimeNano = function() {
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	indexByte = function(s, c) {
		var c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	startsWithLowerCase = function(str) {
		var c, str;
		if (str.length === 0) {
			return false;
		}
		c = str.charCodeAt(0);
		return 97 <= c && c <= 122;
	};
	nextStdChunk = function(layout) {
		var _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$51, _tmp$52, _tmp$53, _tmp$54, _tmp$55, _tmp$56, _tmp$57, _tmp$58, _tmp$59, _tmp$6, _tmp$60, _tmp$61, _tmp$62, _tmp$63, _tmp$64, _tmp$65, _tmp$66, _tmp$67, _tmp$68, _tmp$69, _tmp$7, _tmp$70, _tmp$71, _tmp$72, _tmp$73, _tmp$74, _tmp$75, _tmp$76, _tmp$77, _tmp$78, _tmp$79, _tmp$8, _tmp$80, _tmp$81, _tmp$82, _tmp$83, _tmp$84, _tmp$85, _tmp$86, _tmp$9, c, ch, i, j, layout, prefix, std, std$1, suffix, x$1;
		prefix = "";
		std = 0;
		suffix = "";
		i = 0;
		while (true) {
			if (!(i < layout.length)) { break; }
			c = ((layout.charCodeAt(i) >> 0));
			_1 = c;
			if (_1 === (74)) {
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Jan") {
					if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "January") {
						_tmp = $substring(layout, 0, i);
						_tmp$1 = 257;
						_tmp$2 = $substring(layout, (i + 7 >> 0));
						prefix = _tmp;
						std = _tmp$1;
						suffix = _tmp$2;
						return [prefix, std, suffix];
					}
					if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
						_tmp$3 = $substring(layout, 0, i);
						_tmp$4 = 258;
						_tmp$5 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$3;
						std = _tmp$4;
						suffix = _tmp$5;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (77)) {
				if (layout.length >= (i + 3 >> 0)) {
					if ($substring(layout, i, (i + 3 >> 0)) === "Mon") {
						if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Monday") {
							_tmp$6 = $substring(layout, 0, i);
							_tmp$7 = 261;
							_tmp$8 = $substring(layout, (i + 6 >> 0));
							prefix = _tmp$6;
							std = _tmp$7;
							suffix = _tmp$8;
							return [prefix, std, suffix];
						}
						if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
							_tmp$9 = $substring(layout, 0, i);
							_tmp$10 = 262;
							_tmp$11 = $substring(layout, (i + 3 >> 0));
							prefix = _tmp$9;
							std = _tmp$10;
							suffix = _tmp$11;
							return [prefix, std, suffix];
						}
					}
					if ($substring(layout, i, (i + 3 >> 0)) === "MST") {
						_tmp$12 = $substring(layout, 0, i);
						_tmp$13 = 21;
						_tmp$14 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$12;
						std = _tmp$13;
						suffix = _tmp$14;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (48)) {
				if (layout.length >= (i + 2 >> 0) && 49 <= layout.charCodeAt((i + 1 >> 0)) && layout.charCodeAt((i + 1 >> 0)) <= 54) {
					_tmp$15 = $substring(layout, 0, i);
					_tmp$16 = (x$1 = layout.charCodeAt((i + 1 >> 0)) - 49 << 24 >>> 24, ((x$1 < 0 || x$1 >= std0x.length) ? ($throwRuntimeError("index out of range"), undefined) : std0x[x$1]));
					_tmp$17 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$15;
					std = _tmp$16;
					suffix = _tmp$17;
					return [prefix, std, suffix];
				}
			} else if (_1 === (49)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 53)) {
					_tmp$18 = $substring(layout, 0, i);
					_tmp$19 = 522;
					_tmp$20 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$18;
					std = _tmp$19;
					suffix = _tmp$20;
					return [prefix, std, suffix];
				}
				_tmp$21 = $substring(layout, 0, i);
				_tmp$22 = 259;
				_tmp$23 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$21;
				std = _tmp$22;
				suffix = _tmp$23;
				return [prefix, std, suffix];
			} else if (_1 === (50)) {
				if (layout.length >= (i + 4 >> 0) && $substring(layout, i, (i + 4 >> 0)) === "2006") {
					_tmp$24 = $substring(layout, 0, i);
					_tmp$25 = 273;
					_tmp$26 = $substring(layout, (i + 4 >> 0));
					prefix = _tmp$24;
					std = _tmp$25;
					suffix = _tmp$26;
					return [prefix, std, suffix];
				}
				_tmp$27 = $substring(layout, 0, i);
				_tmp$28 = 263;
				_tmp$29 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$27;
				std = _tmp$28;
				suffix = _tmp$29;
				return [prefix, std, suffix];
			} else if (_1 === (95)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 50)) {
					if (layout.length >= (i + 5 >> 0) && $substring(layout, (i + 1 >> 0), (i + 5 >> 0)) === "2006") {
						_tmp$30 = $substring(layout, 0, (i + 1 >> 0));
						_tmp$31 = 273;
						_tmp$32 = $substring(layout, (i + 5 >> 0));
						prefix = _tmp$30;
						std = _tmp$31;
						suffix = _tmp$32;
						return [prefix, std, suffix];
					}
					_tmp$33 = $substring(layout, 0, i);
					_tmp$34 = 264;
					_tmp$35 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$33;
					std = _tmp$34;
					suffix = _tmp$35;
					return [prefix, std, suffix];
				}
			} else if (_1 === (51)) {
				_tmp$36 = $substring(layout, 0, i);
				_tmp$37 = 523;
				_tmp$38 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$36;
				std = _tmp$37;
				suffix = _tmp$38;
				return [prefix, std, suffix];
			} else if (_1 === (52)) {
				_tmp$39 = $substring(layout, 0, i);
				_tmp$40 = 525;
				_tmp$41 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$39;
				std = _tmp$40;
				suffix = _tmp$41;
				return [prefix, std, suffix];
			} else if (_1 === (53)) {
				_tmp$42 = $substring(layout, 0, i);
				_tmp$43 = 527;
				_tmp$44 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$42;
				std = _tmp$43;
				suffix = _tmp$44;
				return [prefix, std, suffix];
			} else if (_1 === (80)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 77)) {
					_tmp$45 = $substring(layout, 0, i);
					_tmp$46 = 531;
					_tmp$47 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$45;
					std = _tmp$46;
					suffix = _tmp$47;
					return [prefix, std, suffix];
				}
			} else if (_1 === (112)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 109)) {
					_tmp$48 = $substring(layout, 0, i);
					_tmp$49 = 532;
					_tmp$50 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$48;
					std = _tmp$49;
					suffix = _tmp$50;
					return [prefix, std, suffix];
				}
			} else if (_1 === (45)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "-070000") {
					_tmp$51 = $substring(layout, 0, i);
					_tmp$52 = 28;
					_tmp$53 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$51;
					std = _tmp$52;
					suffix = _tmp$53;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "-07:00:00") {
					_tmp$54 = $substring(layout, 0, i);
					_tmp$55 = 31;
					_tmp$56 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$54;
					std = _tmp$55;
					suffix = _tmp$56;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "-0700") {
					_tmp$57 = $substring(layout, 0, i);
					_tmp$58 = 27;
					_tmp$59 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$57;
					std = _tmp$58;
					suffix = _tmp$59;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "-07:00") {
					_tmp$60 = $substring(layout, 0, i);
					_tmp$61 = 30;
					_tmp$62 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$60;
					std = _tmp$61;
					suffix = _tmp$62;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "-07") {
					_tmp$63 = $substring(layout, 0, i);
					_tmp$64 = 29;
					_tmp$65 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$63;
					std = _tmp$64;
					suffix = _tmp$65;
					return [prefix, std, suffix];
				}
			} else if (_1 === (90)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "Z070000") {
					_tmp$66 = $substring(layout, 0, i);
					_tmp$67 = 23;
					_tmp$68 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$66;
					std = _tmp$67;
					suffix = _tmp$68;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "Z07:00:00") {
					_tmp$69 = $substring(layout, 0, i);
					_tmp$70 = 26;
					_tmp$71 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$69;
					std = _tmp$70;
					suffix = _tmp$71;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "Z0700") {
					_tmp$72 = $substring(layout, 0, i);
					_tmp$73 = 22;
					_tmp$74 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$72;
					std = _tmp$73;
					suffix = _tmp$74;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Z07:00") {
					_tmp$75 = $substring(layout, 0, i);
					_tmp$76 = 25;
					_tmp$77 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$75;
					std = _tmp$76;
					suffix = _tmp$77;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Z07") {
					_tmp$78 = $substring(layout, 0, i);
					_tmp$79 = 24;
					_tmp$80 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$78;
					std = _tmp$79;
					suffix = _tmp$80;
					return [prefix, std, suffix];
				}
			} else if (_1 === (46)) {
				if ((i + 1 >> 0) < layout.length && ((layout.charCodeAt((i + 1 >> 0)) === 48) || (layout.charCodeAt((i + 1 >> 0)) === 57))) {
					ch = layout.charCodeAt((i + 1 >> 0));
					j = i + 1 >> 0;
					while (true) {
						if (!(j < layout.length && (layout.charCodeAt(j) === ch))) { break; }
						j = j + (1) >> 0;
					}
					if (!isDigit(layout, j)) {
						std$1 = 32;
						if (layout.charCodeAt((i + 1 >> 0)) === 57) {
							std$1 = 33;
						}
						std$1 = std$1 | ((((j - ((i + 1 >> 0)) >> 0)) << 16 >> 0));
						_tmp$81 = $substring(layout, 0, i);
						_tmp$82 = std$1;
						_tmp$83 = $substring(layout, j);
						prefix = _tmp$81;
						std = _tmp$82;
						suffix = _tmp$83;
						return [prefix, std, suffix];
					}
				}
			}
			i = i + (1) >> 0;
		}
		_tmp$84 = layout;
		_tmp$85 = 0;
		_tmp$86 = "";
		prefix = _tmp$84;
		std = _tmp$85;
		suffix = _tmp$86;
		return [prefix, std, suffix];
	};
	match = function(s1, s2) {
		var c1, c2, i, s1, s2;
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			c2 = s2.charCodeAt(i);
			if (!((c1 === c2))) {
				c1 = (c1 | (32)) >>> 0;
				c2 = (c2 | (32)) >>> 0;
				if (!((c1 === c2)) || c1 < 97 || c1 > 122) {
					return false;
				}
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	lookup = function(tab, val) {
		var _i, _ref, i, tab, v, val;
		_ref = tab;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (val.length >= v.length && match($substring(val, 0, v.length), v)) {
				return [i, $substring(val, v.length), $ifaceNil];
			}
			_i++;
		}
		return [-1, val, errBad];
	};
	appendInt = function(b, x$1, width) {
		var _q, b, buf, i, q, u, w, width, x$1;
		u = ((x$1 >>> 0));
		if (x$1 < 0) {
			b = $append(b, 45);
			u = ((-x$1 >>> 0));
		}
		buf = arrayType.zero();
		i = 20;
		while (true) {
			if (!(u >= 10)) { break; }
			i = i - (1) >> 0;
			q = (_q = u / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[i] = ((((48 + u >>> 0) - (q * 10 >>> 0) >>> 0) << 24 >>> 24)));
			u = q;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[i] = (((48 + u >>> 0) << 24 >>> 24)));
		w = 20 - i >> 0;
		while (true) {
			if (!(w < width)) { break; }
			b = $append(b, 48);
			w = w + (1) >> 0;
		}
		return $appendSlice(b, $subslice(new sliceType$3(buf), i));
	};
	atoi = function(s) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, err, neg, q, rem, s, x$1;
		x$1 = 0;
		err = $ifaceNil;
		neg = false;
		if (!(s === "") && ((s.charCodeAt(0) === 45) || (s.charCodeAt(0) === 43))) {
			neg = s.charCodeAt(0) === 45;
			s = $substring(s, 1);
		}
		_tuple = leadingInt(s);
		q = _tuple[0];
		rem = _tuple[1];
		err = _tuple[2];
		x$1 = (((q.$low + ((q.$high >> 31) * 4294967296)) >> 0));
		if (!($interfaceIsEqual(err, $ifaceNil)) || !(rem === "")) {
			_tmp = 0;
			_tmp$1 = atoiError;
			x$1 = _tmp;
			err = _tmp$1;
			return [x$1, err];
		}
		if (neg) {
			x$1 = -x$1;
		}
		_tmp$2 = x$1;
		_tmp$3 = $ifaceNil;
		x$1 = _tmp$2;
		err = _tmp$3;
		return [x$1, err];
	};
	formatNano = function(b, nanosec, n, trim) {
		var _q, _r, b, buf, n, nanosec, start, trim, u, x$1;
		u = nanosec;
		buf = arrayType$1.zero();
		start = 9;
		while (true) {
			if (!(start > 0)) { break; }
			start = start - (1) >> 0;
			((start < 0 || start >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[start] = ((((_r = u % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24)));
			u = (_q = u / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		if (n > 9) {
			n = 9;
		}
		if (trim) {
			while (true) {
				if (!(n > 0 && ((x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[x$1])) === 48))) { break; }
				n = n - (1) >> 0;
			}
			if (n === 0) {
				return b;
			}
		}
		b = $append(b, 46);
		return $appendSlice(b, $subslice(new sliceType$3(buf), 0, n));
	};
	Time.ptr.prototype.String = function() {
		var _r, _tmp, _tmp$1, _tmp$2, _tmp$3, buf, m0, m1, m2, s, sign, t, wid, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; buf = $f.buf; m0 = $f.m0; m1 = $f.m1; m2 = $f.m2; s = $f.s; sign = $f.sign; t = $f.t; wid = $f.wid; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).Format("2006-01-02 15:04:05.999999999 -0700 MST"); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		s = _r;
		if (!((x$1 = (x$2 = t.wall, new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			m2 = ((x$3 = t.ext, new $Uint64(x$3.$high, x$3.$low)));
			sign = 43;
			if ((x$4 = t.ext, (x$4.$high < 0 || (x$4.$high === 0 && x$4.$low < 0)))) {
				sign = 45;
				m2 = new $Uint64(-m2.$high, -m2.$low);
			}
			_tmp = $div64(m2, new $Uint64(0, 1000000000), false);
			_tmp$1 = $div64(m2, new $Uint64(0, 1000000000), true);
			m1 = _tmp;
			m2 = _tmp$1;
			_tmp$2 = $div64(m1, new $Uint64(0, 1000000000), false);
			_tmp$3 = $div64(m1, new $Uint64(0, 1000000000), true);
			m0 = _tmp$2;
			m1 = _tmp$3;
			buf = sliceType$3.nil;
			buf = $appendSlice(buf, " m=");
			buf = $append(buf, sign);
			wid = 0;
			if (!((m0.$high === 0 && m0.$low === 0))) {
				buf = appendInt(buf, ((m0.$low >> 0)), 0);
				wid = 9;
			}
			buf = appendInt(buf, ((m1.$low >> 0)), wid);
			buf = $append(buf, 46);
			buf = appendInt(buf, ((m2.$low >> 0)), 9);
			s = s + (($bytesToString(buf)));
		}
		$s = -1; return s;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.String }; } $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.buf = buf; $f.m0 = m0; $f.m1 = m1; $f.m2 = m2; $f.s = s; $f.sign = sign; $f.t = t; $f.wid = wid; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.String = function() { return this.$val.String(); };
	Time.ptr.prototype.Format = function(layout) {
		var _r, b, buf, layout, max, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; b = $f.b; buf = $f.buf; layout = $f.layout; max = $f.max; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		b = sliceType$3.nil;
		max = layout.length + 10 >> 0;
		if (max < 64) {
			buf = arrayType$2.zero();
			b = $subslice(new sliceType$3(buf), 0, 0);
		} else {
			b = $makeSlice(sliceType$3, 0, max);
		}
		_r = $clone(t, Time).AppendFormat(b, layout); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		b = _r;
		$s = -1; return ($bytesToString(b));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Format }; } $f._r = _r; $f.b = b; $f.buf = buf; $f.layout = layout; $f.max = max; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Format = function(layout) { return this.$val.Format(layout); };
	Time.ptr.prototype.AppendFormat = function(b, layout) {
		var _1, _q, _q$1, _q$2, _q$3, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tuple, _tuple$1, _tuple$2, _tuple$3, abs, absoffset, b, day, hour, hr, hr$1, layout, m, min, month, name, offset, prefix, s, sec, std, suffix, t, y, year, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; abs = $f.abs; absoffset = $f.absoffset; b = $f.b; day = $f.day; hour = $f.hour; hr = $f.hr; hr$1 = $f.hr$1; layout = $f.layout; m = $f.m; min = $f.min; month = $f.month; name = $f.name; offset = $f.offset; prefix = $f.prefix; s = $f.s; sec = $f.sec; std = $f.std; suffix = $f.suffix; t = $f.t; y = $f.y; year = $f.year; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).locabs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		name = _tuple[0];
		offset = _tuple[1];
		abs = _tuple[2];
		year = -1;
		month = 0;
		day = 0;
		hour = -1;
		min = 0;
		sec = 0;
		while (true) {
			if (!(!(layout === ""))) { break; }
			_tuple$1 = nextStdChunk(layout);
			prefix = _tuple$1[0];
			std = _tuple$1[1];
			suffix = _tuple$1[2];
			if (!(prefix === "")) {
				b = $appendSlice(b, prefix);
			}
			if (std === 0) {
				break;
			}
			layout = suffix;
			if (year < 0 && !(((std & 256) === 0))) {
				_tuple$2 = absDate(abs, true);
				year = _tuple$2[0];
				month = _tuple$2[1];
				day = _tuple$2[2];
			}
			if (hour < 0 && !(((std & 512) === 0))) {
				_tuple$3 = absClock(abs);
				hour = _tuple$3[0];
				min = _tuple$3[1];
				sec = _tuple$3[2];
			}
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					y = year;
					if (y < 0) {
						y = -y;
					}
					b = appendInt(b, (_r$1 = y % 100, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")), 2);
				} else if (_1 === (273)) {
					b = appendInt(b, year, 4);
				} else if (_1 === (258)) {
					b = $appendSlice(b, $substring(new Month(month).String(), 0, 3));
				} else if (_1 === (257)) {
					m = new Month(month).String();
					b = $appendSlice(b, m);
				} else if (_1 === (259)) {
					b = appendInt(b, ((month >> 0)), 0);
				} else if (_1 === (260)) {
					b = appendInt(b, ((month >> 0)), 2);
				} else if (_1 === (262)) {
					b = $appendSlice(b, $substring(new Weekday(absWeekday(abs)).String(), 0, 3));
				} else if (_1 === (261)) {
					s = new Weekday(absWeekday(abs)).String();
					b = $appendSlice(b, s);
				} else if (_1 === (263)) {
					b = appendInt(b, day, 0);
				} else if (_1 === (264)) {
					if (day < 10) {
						b = $append(b, 32);
					}
					b = appendInt(b, day, 0);
				} else if (_1 === (265)) {
					b = appendInt(b, day, 2);
				} else if (_1 === (522)) {
					b = appendInt(b, hour, 2);
				} else if (_1 === (523)) {
					hr = (_r$2 = hour % 12, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero"));
					if (hr === 0) {
						hr = 12;
					}
					b = appendInt(b, hr, 0);
				} else if (_1 === (524)) {
					hr$1 = (_r$3 = hour % 12, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
					if (hr$1 === 0) {
						hr$1 = 12;
					}
					b = appendInt(b, hr$1, 2);
				} else if (_1 === (525)) {
					b = appendInt(b, min, 0);
				} else if (_1 === (526)) {
					b = appendInt(b, min, 2);
				} else if (_1 === (527)) {
					b = appendInt(b, sec, 0);
				} else if (_1 === (528)) {
					b = appendInt(b, sec, 2);
				} else if (_1 === (531)) {
					if (hour >= 12) {
						b = $appendSlice(b, "PM");
					} else {
						b = $appendSlice(b, "AM");
					}
				} else if (_1 === (532)) {
					if (hour >= 12) {
						b = $appendSlice(b, "pm");
					} else {
						b = $appendSlice(b, "am");
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (30)) || (_1 === (28)) || (_1 === (29)) || (_1 === (31))) {
					if ((offset === 0) && ((std === 22) || (std === 25) || (std === 23) || (std === 24) || (std === 26))) {
						b = $append(b, 90);
						break;
					}
					zone$1 = (_q = offset / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					absoffset = offset;
					if (zone$1 < 0) {
						b = $append(b, 45);
						zone$1 = -zone$1;
						absoffset = -absoffset;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$1 = zone$1 / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					if ((std === 25) || (std === 30) || (std === 26) || (std === 31)) {
						b = $append(b, 58);
					}
					if (!((std === 29)) && !((std === 24))) {
						b = appendInt(b, (_r$4 = zone$1 % 60, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero")), 2);
					}
					if ((std === 23) || (std === 28) || (std === 31) || (std === 26)) {
						if ((std === 31) || (std === 26)) {
							b = $append(b, 58);
						}
						b = appendInt(b, (_r$5 = absoffset % 60, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero")), 2);
					}
				} else if (_1 === (21)) {
					if (!(name === "")) {
						b = $appendSlice(b, name);
						break;
					}
					zone$2 = (_q$2 = offset / 60, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					if (zone$2 < 0) {
						b = $append(b, 45);
						zone$2 = -zone$2;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$3 = zone$2 / 60, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					b = appendInt(b, (_r$6 = zone$2 % 60, _r$6 === _r$6 ? _r$6 : $throwRuntimeError("integer divide by zero")), 2);
				} else if ((_1 === (32)) || (_1 === (33))) {
					b = formatNano(b, (($clone(t, Time).Nanosecond() >>> 0)), std >> 16 >> 0, (std & 65535) === 33);
				}
			}
		}
		$s = -1; return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AppendFormat }; } $f._1 = _1; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.abs = abs; $f.absoffset = absoffset; $f.b = b; $f.day = day; $f.hour = hour; $f.hr = hr; $f.hr$1 = hr$1; $f.layout = layout; $f.m = m; $f.min = min; $f.month = month; $f.name = name; $f.offset = offset; $f.prefix = prefix; $f.s = s; $f.sec = sec; $f.std = std; $f.suffix = suffix; $f.t = t; $f.y = y; $f.year = year; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AppendFormat = function(b, layout) { return this.$val.AppendFormat(b, layout); };
	quote = function(s) {
		var s;
		return "\"" + s + "\"";
	};
	ParseError.ptr.prototype.Error = function() {
		var e;
		e = this;
		if (e.Message === "") {
			return "parsing time " + quote(e.Value) + " as " + quote(e.Layout) + ": cannot parse " + quote(e.ValueElem) + " as " + quote(e.LayoutElem);
		}
		return "parsing time " + quote(e.Value) + e.Message;
	};
	ParseError.prototype.Error = function() { return this.$val.Error(); };
	isDigit = function(s, i) {
		var c, i, s;
		if (s.length <= i) {
			return false;
		}
		c = s.charCodeAt(i);
		return 48 <= c && c <= 57;
	};
	getnum = function(s, fixed) {
		var fixed, s;
		if (!isDigit(s, 0)) {
			return [0, s, errBad];
		}
		if (!isDigit(s, 1)) {
			if (fixed) {
				return [0, s, errBad];
			}
			return [(((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0)), $substring(s, 1), $ifaceNil];
		}
		return [($imul((((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0)), 10)) + (((s.charCodeAt(1) - 48 << 24 >>> 24) >> 0)) >> 0, $substring(s, 2), $ifaceNil];
	};
	cutspace = function(s) {
		var s;
		while (true) {
			if (!(s.length > 0 && (s.charCodeAt(0) === 32))) { break; }
			s = $substring(s, 1);
		}
		return s;
	};
	skip = function(value, prefix) {
		var prefix, value;
		while (true) {
			if (!(prefix.length > 0)) { break; }
			if (prefix.charCodeAt(0) === 32) {
				if (value.length > 0 && !((value.charCodeAt(0) === 32))) {
					return [value, errBad];
				}
				prefix = cutspace(prefix);
				value = cutspace(value);
				continue;
			}
			if ((value.length === 0) || !((value.charCodeAt(0) === prefix.charCodeAt(0)))) {
				return [value, errBad];
			}
			prefix = $substring(prefix, 1);
			value = $substring(value, 1);
		}
		return [value, $ifaceNil];
	};
	Parse = function(layout, value) {
		var _r, layout, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; layout = $f.layout; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = parse(layout, value, $pkg.UTC, $pkg.Local); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f._r = _r; $f.layout = layout; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parse = function(layout, value, defaultLocation, local) {
		var _1, _2, _3, _4, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$16, _tuple$17, _tuple$18, _tuple$19, _tuple$2, _tuple$20, _tuple$21, _tuple$22, _tuple$23, _tuple$24, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, alayout, amSet, avalue, day, defaultLocation, err, hour, hour$1, hr, i, layout, local, min, min$1, mm, month, n, n$1, name, ndigit, nsec, offset, offset$1, ok, ok$1, p, pmSet, prefix, rangeErrString, sec, seconds, sign, ss, std, stdstr, suffix, t, t$1, value, x$1, x$2, year, z, zoneName, zoneOffset, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$22 = $f._tmp$22; _tmp$23 = $f._tmp$23; _tmp$24 = $f._tmp$24; _tmp$25 = $f._tmp$25; _tmp$26 = $f._tmp$26; _tmp$27 = $f._tmp$27; _tmp$28 = $f._tmp$28; _tmp$29 = $f._tmp$29; _tmp$3 = $f._tmp$3; _tmp$30 = $f._tmp$30; _tmp$31 = $f._tmp$31; _tmp$32 = $f._tmp$32; _tmp$33 = $f._tmp$33; _tmp$34 = $f._tmp$34; _tmp$35 = $f._tmp$35; _tmp$36 = $f._tmp$36; _tmp$37 = $f._tmp$37; _tmp$38 = $f._tmp$38; _tmp$39 = $f._tmp$39; _tmp$4 = $f._tmp$4; _tmp$40 = $f._tmp$40; _tmp$41 = $f._tmp$41; _tmp$42 = $f._tmp$42; _tmp$43 = $f._tmp$43; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$16 = $f._tuple$16; _tuple$17 = $f._tuple$17; _tuple$18 = $f._tuple$18; _tuple$19 = $f._tuple$19; _tuple$2 = $f._tuple$2; _tuple$20 = $f._tuple$20; _tuple$21 = $f._tuple$21; _tuple$22 = $f._tuple$22; _tuple$23 = $f._tuple$23; _tuple$24 = $f._tuple$24; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; alayout = $f.alayout; amSet = $f.amSet; avalue = $f.avalue; day = $f.day; defaultLocation = $f.defaultLocation; err = $f.err; hour = $f.hour; hour$1 = $f.hour$1; hr = $f.hr; i = $f.i; layout = $f.layout; local = $f.local; min = $f.min; min$1 = $f.min$1; mm = $f.mm; month = $f.month; n = $f.n; n$1 = $f.n$1; name = $f.name; ndigit = $f.ndigit; nsec = $f.nsec; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; pmSet = $f.pmSet; prefix = $f.prefix; rangeErrString = $f.rangeErrString; sec = $f.sec; seconds = $f.seconds; sign = $f.sign; ss = $f.ss; std = $f.std; stdstr = $f.stdstr; suffix = $f.suffix; t = $f.t; t$1 = $f.t$1; value = $f.value; x$1 = $f.x$1; x$2 = $f.x$2; year = $f.year; z = $f.z; zoneName = $f.zoneName; zoneOffset = $f.zoneOffset; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = layout;
		_tmp$1 = value;
		alayout = _tmp;
		avalue = _tmp$1;
		rangeErrString = "";
		amSet = false;
		pmSet = false;
		year = 0;
		month = 1;
		day = 1;
		hour = 0;
		min = 0;
		sec = 0;
		nsec = 0;
		z = ptrType$2.nil;
		zoneOffset = -1;
		zoneName = "";
		while (true) {
			err = $ifaceNil;
			_tuple = nextStdChunk(layout);
			prefix = _tuple[0];
			std = _tuple[1];
			suffix = _tuple[2];
			stdstr = $substring(layout, prefix.length, (layout.length - suffix.length >> 0));
			_tuple$1 = skip(value, prefix);
			value = _tuple$1[0];
			err = _tuple$1[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
			}
			if (std === 0) {
				if (!((value.length === 0))) {
					$s = -1; return [new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
				}
				break;
			}
			layout = suffix;
			p = "";
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$2 = $substring(value, 0, 2);
					_tmp$3 = $substring(value, 2);
					p = _tmp$2;
					value = _tmp$3;
					_tuple$2 = atoi(p);
					year = _tuple$2[0];
					err = _tuple$2[1];
					if (year >= 69) {
						year = year + (1900) >> 0;
					} else {
						year = year + (2000) >> 0;
					}
				} else if (_1 === (273)) {
					if (value.length < 4 || !isDigit(value, 0)) {
						err = errBad;
						break;
					}
					_tmp$4 = $substring(value, 0, 4);
					_tmp$5 = $substring(value, 4);
					p = _tmp$4;
					value = _tmp$5;
					_tuple$3 = atoi(p);
					year = _tuple$3[0];
					err = _tuple$3[1];
				} else if (_1 === (258)) {
					_tuple$4 = lookup(shortMonthNames, value);
					month = _tuple$4[0];
					value = _tuple$4[1];
					err = _tuple$4[2];
					month = month + (1) >> 0;
				} else if (_1 === (257)) {
					_tuple$5 = lookup(longMonthNames, value);
					month = _tuple$5[0];
					value = _tuple$5[1];
					err = _tuple$5[2];
					month = month + (1) >> 0;
				} else if ((_1 === (259)) || (_1 === (260))) {
					_tuple$6 = getnum(value, std === 260);
					month = _tuple$6[0];
					value = _tuple$6[1];
					err = _tuple$6[2];
					if (month <= 0 || 12 < month) {
						rangeErrString = "month";
					}
				} else if (_1 === (262)) {
					_tuple$7 = lookup(shortDayNames, value);
					value = _tuple$7[1];
					err = _tuple$7[2];
				} else if (_1 === (261)) {
					_tuple$8 = lookup(longDayNames, value);
					value = _tuple$8[1];
					err = _tuple$8[2];
				} else if ((_1 === (263)) || (_1 === (264)) || (_1 === (265))) {
					if ((std === 264) && value.length > 0 && (value.charCodeAt(0) === 32)) {
						value = $substring(value, 1);
					}
					_tuple$9 = getnum(value, std === 265);
					day = _tuple$9[0];
					value = _tuple$9[1];
					err = _tuple$9[2];
					if (day < 0) {
						rangeErrString = "day";
					}
				} else if (_1 === (522)) {
					_tuple$10 = getnum(value, false);
					hour = _tuple$10[0];
					value = _tuple$10[1];
					err = _tuple$10[2];
					if (hour < 0 || 24 <= hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (523)) || (_1 === (524))) {
					_tuple$11 = getnum(value, std === 524);
					hour = _tuple$11[0];
					value = _tuple$11[1];
					err = _tuple$11[2];
					if (hour < 0 || 12 < hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (525)) || (_1 === (526))) {
					_tuple$12 = getnum(value, std === 526);
					min = _tuple$12[0];
					value = _tuple$12[1];
					err = _tuple$12[2];
					if (min < 0 || 60 <= min) {
						rangeErrString = "minute";
					}
				} else if ((_1 === (527)) || (_1 === (528))) {
					_tuple$13 = getnum(value, std === 528);
					sec = _tuple$13[0];
					value = _tuple$13[1];
					err = _tuple$13[2];
					if (sec < 0 || 60 <= sec) {
						rangeErrString = "second";
						break;
					}
					if (value.length >= 2 && (value.charCodeAt(0) === 46) && isDigit(value, 1)) {
						_tuple$14 = nextStdChunk(layout);
						std = _tuple$14[1];
						std = std & (65535);
						if ((std === 32) || (std === 33)) {
							break;
						}
						n = 2;
						while (true) {
							if (!(n < value.length && isDigit(value, n))) { break; }
							n = n + (1) >> 0;
						}
						_tuple$15 = parseNanoseconds(value, n);
						nsec = _tuple$15[0];
						rangeErrString = _tuple$15[1];
						err = _tuple$15[2];
						value = $substring(value, n);
					}
				} else if (_1 === (531)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$6 = $substring(value, 0, 2);
					_tmp$7 = $substring(value, 2);
					p = _tmp$6;
					value = _tmp$7;
					_2 = p;
					if (_2 === ("PM")) {
						pmSet = true;
					} else if (_2 === ("AM")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if (_1 === (532)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$8 = $substring(value, 0, 2);
					_tmp$9 = $substring(value, 2);
					p = _tmp$8;
					value = _tmp$9;
					_3 = p;
					if (_3 === ("pm")) {
						pmSet = true;
					} else if (_3 === ("am")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (29)) || (_1 === (30)) || (_1 === (28)) || (_1 === (31))) {
					if (((std === 22) || (std === 24) || (std === 25)) && value.length >= 1 && (value.charCodeAt(0) === 90)) {
						value = $substring(value, 1);
						z = $pkg.UTC;
						break;
					}
					_tmp$10 = "";
					_tmp$11 = "";
					_tmp$12 = "";
					_tmp$13 = "";
					sign = _tmp$10;
					hour$1 = _tmp$11;
					min$1 = _tmp$12;
					seconds = _tmp$13;
					if ((std === 25) || (std === 30)) {
						if (value.length < 6) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58))) {
							err = errBad;
							break;
						}
						_tmp$14 = $substring(value, 0, 1);
						_tmp$15 = $substring(value, 1, 3);
						_tmp$16 = $substring(value, 4, 6);
						_tmp$17 = "00";
						_tmp$18 = $substring(value, 6);
						sign = _tmp$14;
						hour$1 = _tmp$15;
						min$1 = _tmp$16;
						seconds = _tmp$17;
						value = _tmp$18;
					} else if ((std === 29) || (std === 24)) {
						if (value.length < 3) {
							err = errBad;
							break;
						}
						_tmp$19 = $substring(value, 0, 1);
						_tmp$20 = $substring(value, 1, 3);
						_tmp$21 = "00";
						_tmp$22 = "00";
						_tmp$23 = $substring(value, 3);
						sign = _tmp$19;
						hour$1 = _tmp$20;
						min$1 = _tmp$21;
						seconds = _tmp$22;
						value = _tmp$23;
					} else if ((std === 26) || (std === 31)) {
						if (value.length < 9) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58)) || !((value.charCodeAt(6) === 58))) {
							err = errBad;
							break;
						}
						_tmp$24 = $substring(value, 0, 1);
						_tmp$25 = $substring(value, 1, 3);
						_tmp$26 = $substring(value, 4, 6);
						_tmp$27 = $substring(value, 7, 9);
						_tmp$28 = $substring(value, 9);
						sign = _tmp$24;
						hour$1 = _tmp$25;
						min$1 = _tmp$26;
						seconds = _tmp$27;
						value = _tmp$28;
					} else if ((std === 23) || (std === 28)) {
						if (value.length < 7) {
							err = errBad;
							break;
						}
						_tmp$29 = $substring(value, 0, 1);
						_tmp$30 = $substring(value, 1, 3);
						_tmp$31 = $substring(value, 3, 5);
						_tmp$32 = $substring(value, 5, 7);
						_tmp$33 = $substring(value, 7);
						sign = _tmp$29;
						hour$1 = _tmp$30;
						min$1 = _tmp$31;
						seconds = _tmp$32;
						value = _tmp$33;
					} else {
						if (value.length < 5) {
							err = errBad;
							break;
						}
						_tmp$34 = $substring(value, 0, 1);
						_tmp$35 = $substring(value, 1, 3);
						_tmp$36 = $substring(value, 3, 5);
						_tmp$37 = "00";
						_tmp$38 = $substring(value, 5);
						sign = _tmp$34;
						hour$1 = _tmp$35;
						min$1 = _tmp$36;
						seconds = _tmp$37;
						value = _tmp$38;
					}
					_tmp$39 = 0;
					_tmp$40 = 0;
					_tmp$41 = 0;
					hr = _tmp$39;
					mm = _tmp$40;
					ss = _tmp$41;
					_tuple$16 = atoi(hour$1);
					hr = _tuple$16[0];
					err = _tuple$16[1];
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$17 = atoi(min$1);
						mm = _tuple$17[0];
						err = _tuple$17[1];
					}
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$18 = atoi(seconds);
						ss = _tuple$18[0];
						err = _tuple$18[1];
					}
					zoneOffset = ($imul(((($imul(hr, 60)) + mm >> 0)), 60)) + ss >> 0;
					_4 = sign.charCodeAt(0);
					if (_4 === (43)) {
					} else if (_4 === (45)) {
						zoneOffset = -zoneOffset;
					} else {
						err = errBad;
					}
				} else if (_1 === (21)) {
					if (value.length >= 3 && $substring(value, 0, 3) === "UTC") {
						z = $pkg.UTC;
						value = $substring(value, 3);
						break;
					}
					_tuple$19 = parseTimeZone(value);
					n$1 = _tuple$19[0];
					ok = _tuple$19[1];
					if (!ok) {
						err = errBad;
						break;
					}
					_tmp$42 = $substring(value, 0, n$1);
					_tmp$43 = $substring(value, n$1);
					zoneName = _tmp$42;
					value = _tmp$43;
				} else if (_1 === (32)) {
					ndigit = 1 + ((std >> 16 >> 0)) >> 0;
					if (value.length < ndigit) {
						err = errBad;
						break;
					}
					_tuple$20 = parseNanoseconds(value, ndigit);
					nsec = _tuple$20[0];
					rangeErrString = _tuple$20[1];
					err = _tuple$20[2];
					value = $substring(value, ndigit);
				} else if (_1 === (33)) {
					if (value.length < 2 || !((value.charCodeAt(0) === 46)) || value.charCodeAt(1) < 48 || 57 < value.charCodeAt(1)) {
						break;
					}
					i = 0;
					while (true) {
						if (!(i < 9 && (i + 1 >> 0) < value.length && 48 <= value.charCodeAt((i + 1 >> 0)) && value.charCodeAt((i + 1 >> 0)) <= 57)) { break; }
						i = i + (1) >> 0;
					}
					_tuple$21 = parseNanoseconds(value, 1 + i >> 0);
					nsec = _tuple$21[0];
					rangeErrString = _tuple$21[1];
					err = _tuple$21[2];
					value = $substring(value, (1 + i >> 0));
				}
			}
			if (!(rangeErrString === "")) {
				$s = -1; return [new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
			}
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
			}
		}
		if (pmSet && hour < 12) {
			hour = hour + (12) >> 0;
		} else if (amSet && (hour === 12)) {
			hour = 0;
		}
		if (day < 1 || day > daysIn(((month >> 0)), year)) {
			$s = -1; return [new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
		}
		/* */ if (!(z === ptrType$2.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(z === ptrType$2.nil)) { */ case 1:
			_r = Date(year, ((month >> 0)), day, hour, min, sec, nsec, z); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return [_r, $ifaceNil];
		/* } */ case 2:
		/* */ if (!((zoneOffset === -1))) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!((zoneOffset === -1))) { */ case 4:
			_r$1 = Date(year, ((month >> 0)), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			t = $clone(_r$1, Time);
			t.addSec((x$1 = (new $Int64(0, zoneOffset)), new $Int64(-x$1.$high, -x$1.$low)));
			_r$2 = local.lookup(t.unixSec()); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$22 = _r$2;
			name = _tuple$22[0];
			offset = _tuple$22[1];
			if ((offset === zoneOffset) && (zoneName === "" || name === zoneName)) {
				t.setLoc(local);
				$s = -1; return [t, $ifaceNil];
			}
			t.setLoc(FixedZone(zoneName, zoneOffset));
			$s = -1; return [t, $ifaceNil];
		/* } */ case 5:
		/* */ if (!(zoneName === "")) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!(zoneName === "")) { */ case 8:
			_r$3 = Date(year, ((month >> 0)), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			t$1 = $clone(_r$3, Time);
			_r$4 = local.lookupName(zoneName, t$1.unixSec()); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_tuple$23 = _r$4;
			offset$1 = _tuple$23[0];
			ok$1 = _tuple$23[1];
			if (ok$1) {
				t$1.addSec((x$2 = (new $Int64(0, offset$1)), new $Int64(-x$2.$high, -x$2.$low)));
				t$1.setLoc(local);
				$s = -1; return [t$1, $ifaceNil];
			}
			if (zoneName.length > 3 && $substring(zoneName, 0, 3) === "GMT") {
				_tuple$24 = atoi($substring(zoneName, 3));
				offset$1 = _tuple$24[0];
				offset$1 = $imul(offset$1, (3600));
			}
			t$1.setLoc(FixedZone(zoneName, offset$1));
			$s = -1; return [t$1, $ifaceNil];
		/* } */ case 9:
		_r$5 = Date(year, ((month >> 0)), day, hour, min, sec, nsec, defaultLocation); /* */ $s = 12; case 12: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		$s = -1; return [_r$5, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parse }; } $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$22 = _tmp$22; $f._tmp$23 = _tmp$23; $f._tmp$24 = _tmp$24; $f._tmp$25 = _tmp$25; $f._tmp$26 = _tmp$26; $f._tmp$27 = _tmp$27; $f._tmp$28 = _tmp$28; $f._tmp$29 = _tmp$29; $f._tmp$3 = _tmp$3; $f._tmp$30 = _tmp$30; $f._tmp$31 = _tmp$31; $f._tmp$32 = _tmp$32; $f._tmp$33 = _tmp$33; $f._tmp$34 = _tmp$34; $f._tmp$35 = _tmp$35; $f._tmp$36 = _tmp$36; $f._tmp$37 = _tmp$37; $f._tmp$38 = _tmp$38; $f._tmp$39 = _tmp$39; $f._tmp$4 = _tmp$4; $f._tmp$40 = _tmp$40; $f._tmp$41 = _tmp$41; $f._tmp$42 = _tmp$42; $f._tmp$43 = _tmp$43; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$16 = _tuple$16; $f._tuple$17 = _tuple$17; $f._tuple$18 = _tuple$18; $f._tuple$19 = _tuple$19; $f._tuple$2 = _tuple$2; $f._tuple$20 = _tuple$20; $f._tuple$21 = _tuple$21; $f._tuple$22 = _tuple$22; $f._tuple$23 = _tuple$23; $f._tuple$24 = _tuple$24; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.alayout = alayout; $f.amSet = amSet; $f.avalue = avalue; $f.day = day; $f.defaultLocation = defaultLocation; $f.err = err; $f.hour = hour; $f.hour$1 = hour$1; $f.hr = hr; $f.i = i; $f.layout = layout; $f.local = local; $f.min = min; $f.min$1 = min$1; $f.mm = mm; $f.month = month; $f.n = n; $f.n$1 = n$1; $f.name = name; $f.ndigit = ndigit; $f.nsec = nsec; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.pmSet = pmSet; $f.prefix = prefix; $f.rangeErrString = rangeErrString; $f.sec = sec; $f.seconds = seconds; $f.sign = sign; $f.ss = ss; $f.std = std; $f.stdstr = stdstr; $f.suffix = suffix; $f.t = t; $f.t$1 = t$1; $f.value = value; $f.x$1 = x$1; $f.x$2 = x$2; $f.year = year; $f.z = z; $f.zoneName = zoneName; $f.zoneOffset = zoneOffset; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseTimeZone = function(value) {
		var _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, length, nUpper, ok, ok$1, value;
		length = 0;
		ok = false;
		if (value.length < 3) {
			_tmp = 0;
			_tmp$1 = false;
			length = _tmp;
			ok = _tmp$1;
			return [length, ok];
		}
		if (value.length >= 4 && ($substring(value, 0, 4) === "ChST" || $substring(value, 0, 4) === "MeST")) {
			_tmp$2 = 4;
			_tmp$3 = true;
			length = _tmp$2;
			ok = _tmp$3;
			return [length, ok];
		}
		if ($substring(value, 0, 3) === "GMT") {
			length = parseGMT(value);
			_tmp$4 = length;
			_tmp$5 = true;
			length = _tmp$4;
			ok = _tmp$5;
			return [length, ok];
		}
		if ((value.charCodeAt(0) === 43) || (value.charCodeAt(0) === 45)) {
			length = parseSignedOffset(value);
			ok$1 = length > 0;
			_tmp$6 = length;
			_tmp$7 = ok$1;
			length = _tmp$6;
			ok = _tmp$7;
			return [length, ok];
		}
		nUpper = 0;
		nUpper = 0;
		while (true) {
			if (!(nUpper < 6)) { break; }
			if (nUpper >= value.length) {
				break;
			}
			c = value.charCodeAt(nUpper);
			if (c < 65 || 90 < c) {
				break;
			}
			nUpper = nUpper + (1) >> 0;
		}
		_1 = nUpper;
		if ((_1 === (0)) || (_1 === (1)) || (_1 === (2)) || (_1 === (6))) {
			_tmp$8 = 0;
			_tmp$9 = false;
			length = _tmp$8;
			ok = _tmp$9;
			return [length, ok];
		} else if (_1 === (5)) {
			if (value.charCodeAt(4) === 84) {
				_tmp$10 = 5;
				_tmp$11 = true;
				length = _tmp$10;
				ok = _tmp$11;
				return [length, ok];
			}
		} else if (_1 === (4)) {
			if ((value.charCodeAt(3) === 84) || $substring(value, 0, 4) === "WITA") {
				_tmp$12 = 4;
				_tmp$13 = true;
				length = _tmp$12;
				ok = _tmp$13;
				return [length, ok];
			}
		} else if (_1 === (3)) {
			_tmp$14 = 3;
			_tmp$15 = true;
			length = _tmp$14;
			ok = _tmp$15;
			return [length, ok];
		}
		_tmp$16 = 0;
		_tmp$17 = false;
		length = _tmp$16;
		ok = _tmp$17;
		return [length, ok];
	};
	parseGMT = function(value) {
		var value;
		value = $substring(value, 3);
		if (value.length === 0) {
			return 3;
		}
		return 3 + parseSignedOffset(value) >> 0;
	};
	parseSignedOffset = function(value) {
		var _tuple, err, rem, sign, value, x$1;
		sign = value.charCodeAt(0);
		if (!((sign === 45)) && !((sign === 43))) {
			return 0;
		}
		_tuple = leadingInt($substring(value, 1));
		x$1 = _tuple[0];
		rem = _tuple[1];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil)) || $substring(value, 1) === rem) {
			return 0;
		}
		if (sign === 45) {
			x$1 = new $Int64(-x$1.$high, -x$1.$low);
		}
		if ((x$1.$high < -1 || (x$1.$high === -1 && x$1.$low < 4294967273)) || (0 < x$1.$high || (0 === x$1.$high && 23 < x$1.$low))) {
			return 0;
		}
		return value.length - rem.length >> 0;
	};
	parseNanoseconds = function(value, nbytes) {
		var _tuple, err, i, nbytes, ns, rangeErrString, scaleDigits, value;
		ns = 0;
		rangeErrString = "";
		err = $ifaceNil;
		if (!((value.charCodeAt(0) === 46))) {
			err = errBad;
			return [ns, rangeErrString, err];
		}
		_tuple = atoi($substring(value, 1, nbytes));
		ns = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ns, rangeErrString, err];
		}
		if (ns < 0 || 1000000000 <= ns) {
			rangeErrString = "fractional second";
			return [ns, rangeErrString, err];
		}
		scaleDigits = 10 - nbytes >> 0;
		i = 0;
		while (true) {
			if (!(i < scaleDigits)) { break; }
			ns = $imul(ns, (10));
			i = i + (1) >> 0;
		}
		return [ns, rangeErrString, err];
	};
	leadingInt = function(s) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, c, err, i, rem, s, x$1, x$2, x$3, x$4;
		x$1 = new $Int64(0, 0);
		rem = "";
		err = $ifaceNil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c < 48 || c > 57) {
				break;
			}
			if ((x$1.$high > 214748364 || (x$1.$high === 214748364 && x$1.$low > 3435973836))) {
				_tmp = new $Int64(0, 0);
				_tmp$1 = "";
				_tmp$2 = errLeadingInt;
				x$1 = _tmp;
				rem = _tmp$1;
				err = _tmp$2;
				return [x$1, rem, err];
			}
			x$1 = (x$2 = (x$3 = $mul64(x$1, new $Int64(0, 10)), x$4 = (new $Int64(0, c)), new $Int64(x$3.$high + x$4.$high, x$3.$low + x$4.$low)), new $Int64(x$2.$high - 0, x$2.$low - 48));
			if ((x$1.$high < 0 || (x$1.$high === 0 && x$1.$low < 0))) {
				_tmp$3 = new $Int64(0, 0);
				_tmp$4 = "";
				_tmp$5 = errLeadingInt;
				x$1 = _tmp$3;
				rem = _tmp$4;
				err = _tmp$5;
				return [x$1, rem, err];
			}
			i = i + (1) >> 0;
		}
		_tmp$6 = x$1;
		_tmp$7 = $substring(s, i);
		_tmp$8 = $ifaceNil;
		x$1 = _tmp$6;
		rem = _tmp$7;
		err = _tmp$8;
		return [x$1, rem, err];
	};
	Time.ptr.prototype.nsec = function() {
		var t, x$1;
		t = this;
		return (((x$1 = t.wall, new $Uint64(x$1.$high & 0, (x$1.$low & 1073741823) >>> 0)).$low >> 0));
	};
	Time.prototype.nsec = function() { return this.$val.nsec(); };
	Time.ptr.prototype.sec = function() {
		var t, x$1, x$2, x$3, x$4;
		t = this;
		if (!((x$1 = (x$2 = t.wall, new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			return (x$3 = ((x$4 = $shiftRightUint64($shiftLeft64(t.wall, 1), 31), new $Int64(x$4.$high, x$4.$low))), new $Int64(13 + x$3.$high, 3618733952 + x$3.$low));
		}
		return t.ext;
	};
	Time.prototype.sec = function() { return this.$val.sec(); };
	Time.ptr.prototype.unixSec = function() {
		var t, x$1;
		t = this;
		return (x$1 = t.sec(), new $Int64(x$1.$high + -15, x$1.$low + 2288912640));
	};
	Time.prototype.unixSec = function() { return this.$val.unixSec(); };
	Time.ptr.prototype.addSec = function(d) {
		var d, dsec, sec, t, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		t = this;
		if (!((x$1 = (x$2 = t.wall, new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			sec = ((x$3 = $shiftRightUint64($shiftLeft64(t.wall, 1), 31), new $Int64(x$3.$high, x$3.$low)));
			dsec = new $Int64(sec.$high + d.$high, sec.$low + d.$low);
			if ((0 < dsec.$high || (0 === dsec.$high && 0 <= dsec.$low)) && (dsec.$high < 1 || (dsec.$high === 1 && dsec.$low <= 4294967295))) {
				t.wall = (x$4 = (x$5 = (x$6 = t.wall, new $Uint64(x$6.$high & 0, (x$6.$low & 1073741823) >>> 0)), x$7 = $shiftLeft64((new $Uint64(dsec.$high, dsec.$low)), 30), new $Uint64(x$5.$high | x$7.$high, (x$5.$low | x$7.$low) >>> 0)), new $Uint64(x$4.$high | 2147483648, (x$4.$low | 0) >>> 0));
				return;
			}
			t.stripMono();
		}
		t.ext = (x$8 = t.ext, x$9 = d, new $Int64(x$8.$high + x$9.$high, x$8.$low + x$9.$low));
	};
	Time.prototype.addSec = function(d) { return this.$val.addSec(d); };
	Time.ptr.prototype.setLoc = function(loc) {
		var loc, t;
		t = this;
		if (loc === utcLoc) {
			loc = ptrType$2.nil;
		}
		t.stripMono();
		t.loc = loc;
	};
	Time.prototype.setLoc = function(loc) { return this.$val.setLoc(loc); };
	Time.ptr.prototype.stripMono = function() {
		var t, x$1, x$2, x$3, x$4;
		t = this;
		if (!((x$1 = (x$2 = t.wall, new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			t.ext = t.sec();
			t.wall = (x$3 = t.wall, x$4 = new $Uint64(0, 1073741823), new $Uint64(x$3.$high & x$4.$high, (x$3.$low & x$4.$low) >>> 0));
		}
	};
	Time.prototype.stripMono = function() { return this.$val.stripMono(); };
	Time.ptr.prototype.After = function(u) {
		var t, ts, u, us, x$1, x$2, x$3, x$4, x$5, x$6;
		t = this;
		if (!((x$1 = (x$2 = (x$3 = t.wall, x$4 = u.wall, new $Uint64(x$3.$high & x$4.$high, (x$3.$low & x$4.$low) >>> 0)), new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			return (x$5 = t.ext, x$6 = u.ext, (x$5.$high > x$6.$high || (x$5.$high === x$6.$high && x$5.$low > x$6.$low)));
		}
		ts = t.sec();
		us = u.sec();
		return (ts.$high > us.$high || (ts.$high === us.$high && ts.$low > us.$low)) || (ts.$high === us.$high && ts.$low === us.$low) && t.nsec() > u.nsec();
	};
	Time.prototype.After = function(u) { return this.$val.After(u); };
	Time.ptr.prototype.Before = function(u) {
		var t, u, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		t = this;
		if (!((x$1 = (x$2 = (x$3 = t.wall, x$4 = u.wall, new $Uint64(x$3.$high & x$4.$high, (x$3.$low & x$4.$low) >>> 0)), new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			return (x$5 = t.ext, x$6 = u.ext, (x$5.$high < x$6.$high || (x$5.$high === x$6.$high && x$5.$low < x$6.$low)));
		}
		return (x$7 = t.sec(), x$8 = u.sec(), (x$7.$high < x$8.$high || (x$7.$high === x$8.$high && x$7.$low < x$8.$low))) || (x$9 = t.sec(), x$10 = u.sec(), (x$9.$high === x$10.$high && x$9.$low === x$10.$low)) && t.nsec() < u.nsec();
	};
	Time.prototype.Before = function(u) { return this.$val.Before(u); };
	Time.ptr.prototype.Equal = function(u) {
		var t, u, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8;
		t = this;
		if (!((x$1 = (x$2 = (x$3 = t.wall, x$4 = u.wall, new $Uint64(x$3.$high & x$4.$high, (x$3.$low & x$4.$low) >>> 0)), new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			return (x$5 = t.ext, x$6 = u.ext, (x$5.$high === x$6.$high && x$5.$low === x$6.$low));
		}
		return (x$7 = t.sec(), x$8 = u.sec(), (x$7.$high === x$8.$high && x$7.$low === x$8.$low)) && (t.nsec() === u.nsec());
	};
	Time.prototype.Equal = function(u) { return this.$val.Equal(u); };
	Month.prototype.String = function() {
		var buf, m, n, x$1;
		m = this.$val;
		if (1 <= m && m <= 12) {
			return (x$1 = m - 1 >> 0, ((x$1 < 0 || x$1 >= months.length) ? ($throwRuntimeError("index out of range"), undefined) : months[x$1]));
		}
		buf = $makeSlice(sliceType$3, 20);
		n = fmtInt(buf, (new $Uint64(0, m)));
		return "%!Month(" + ($bytesToString($subslice(buf, n))) + ")";
	};
	$ptrType(Month).prototype.String = function() { return new Month(this.$get()).String(); };
	Weekday.prototype.String = function() {
		var buf, d, n;
		d = this.$val;
		if (0 <= d && d <= 6) {
			return ((d < 0 || d >= days.length) ? ($throwRuntimeError("index out of range"), undefined) : days[d]);
		}
		buf = $makeSlice(sliceType$3, 20);
		n = fmtInt(buf, (new $Uint64(0, d)));
		return "%!Weekday(" + ($bytesToString($subslice(buf, n))) + ")";
	};
	$ptrType(Weekday).prototype.String = function() { return new Weekday(this.$get()).String(); };
	Time.ptr.prototype.IsZero = function() {
		var t, x$1;
		t = this;
		return (x$1 = t.sec(), (x$1.$high === 0 && x$1.$low === 0)) && (t.nsec() === 0);
	};
	Time.prototype.IsZero = function() { return this.$val.IsZero(); };
	Time.ptr.prototype.abs = function() {
		var _r, _r$1, _tuple, l, offset, sec, t, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; l = $f.l; offset = $f.offset; sec = $f.sec; t = $f.t; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		l = t.loc;
		/* */ if (l === ptrType$2.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$2.nil || l === localLoc) { */ case 1:
			_r = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			l = _r;
		/* } */ case 2:
		sec = t.unixSec();
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 6:
				sec = (x$3 = (new $Int64(0, l.cacheZone.offset)), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
				$s = 8; continue;
			/* } else { */ case 7:
				_r$1 = l.lookup(sec); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple = _r$1;
				offset = _tuple[1];
				sec = (x$4 = (new $Int64(0, offset)), new $Int64(sec.$high + x$4.$high, sec.$low + x$4.$low));
			/* } */ case 8:
		/* } */ case 5:
		$s = -1; return ((x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.abs }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.l = l; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.abs = function() { return this.$val.abs(); };
	Time.ptr.prototype.locabs = function() {
		var _r, _r$1, _tuple, abs, l, name, offset, sec, t, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; abs = $f.abs; l = $f.l; name = $f.name; offset = $f.offset; sec = $f.sec; t = $f.t; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		abs = new $Uint64(0, 0);
		t = this;
		l = t.loc;
		/* */ if (l === ptrType$2.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$2.nil || l === localLoc) { */ case 1:
			_r = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			l = _r;
		/* } */ case 2:
		sec = t.unixSec();
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 7:
				name = l.cacheZone.name;
				offset = l.cacheZone.offset;
				$s = 9; continue;
			/* } else { */ case 8:
				_r$1 = l.lookup(sec); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple = _r$1;
				name = _tuple[0];
				offset = _tuple[1];
			/* } */ case 9:
			sec = (x$3 = (new $Int64(0, offset)), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
			$s = 6; continue;
		/* } else { */ case 5:
			name = "UTC";
		/* } */ case 6:
		abs = ((x$4 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$4.$high, x$4.$low)));
		$s = -1; return [name, offset, abs];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.locabs }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.abs = abs; $f.l = l; $f.name = name; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.locabs = function() { return this.$val.locabs(); };
	Time.ptr.prototype.Date = function() {
		var _r, _tuple, day, month, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; day = $f.day; month = $f.month; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		t = this;
		_r = $clone(t, Time).date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		year = _tuple[0];
		month = _tuple[1];
		day = _tuple[2];
		$s = -1; return [year, month, day];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Date }; } $f._r = _r; $f._tuple = _tuple; $f.day = day; $f.month = month; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Date = function() { return this.$val.Date(); };
	Time.ptr.prototype.Year = function() {
		var _r, _tuple, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		year = _tuple[0];
		$s = -1; return year;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Year }; } $f._r = _r; $f._tuple = _tuple; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Year = function() { return this.$val.Year(); };
	Time.ptr.prototype.Month = function() {
		var _r, _tuple, month, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; month = $f.month; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		month = _tuple[1];
		$s = -1; return month;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Month }; } $f._r = _r; $f._tuple = _tuple; $f.month = month; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Month = function() { return this.$val.Month(); };
	Time.ptr.prototype.Day = function() {
		var _r, _tuple, day, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; day = $f.day; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		day = _tuple[2];
		$s = -1; return day;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Day }; } $f._r = _r; $f._tuple = _tuple; $f.day = day; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Day = function() { return this.$val.Day(); };
	Time.ptr.prototype.Weekday = function() {
		var _r, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = absWeekday(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Weekday }; } $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Weekday = function() { return this.$val.Weekday(); };
	absWeekday = function(abs) {
		var _q, abs, sec;
		sec = $div64((new $Uint64(abs.$high + 0, abs.$low + 86400)), new $Uint64(0, 604800), true);
		return (((_q = ((sec.$low >> 0)) / 86400, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0));
	};
	Time.ptr.prototype.ISOWeek = function() {
		var _q, _r, _r$1, _r$2, _r$3, _r$4, _tuple, day, dec31wday, jan1wday, month, t, wday, week, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tuple = $f._tuple; day = $f.day; dec31wday = $f.dec31wday; jan1wday = $f.jan1wday; month = $f.month; t = $f.t; wday = $f.wday; week = $f.week; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		week = 0;
		t = this;
		_r = $clone(t, Time).date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		year = _tuple[0];
		month = _tuple[1];
		day = _tuple[2];
		yday = _tuple[3];
		_r$2 = $clone(t, Time).Weekday(); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		wday = (_r$1 = (((_r$2 + 6 >> 0) >> 0)) % 7, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero"));
		week = (_q = (((yday - wday >> 0) + 7 >> 0)) / 7, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		jan1wday = (_r$3 = (((wday - yday >> 0) + 371 >> 0)) % 7, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
		if (1 <= jan1wday && jan1wday <= 3) {
			week = week + (1) >> 0;
		}
		if (week === 0) {
			year = year - (1) >> 0;
			week = 52;
			if ((jan1wday === 4) || ((jan1wday === 5) && isLeap(year))) {
				week = week + (1) >> 0;
			}
		}
		if ((month === 12) && day >= 29 && wday < 3) {
			dec31wday = (_r$4 = (((wday + 31 >> 0) - day >> 0)) % 7, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
			if (0 <= dec31wday && dec31wday <= 2) {
				year = year + (1) >> 0;
				week = 1;
			}
		}
		$s = -1; return [year, week];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.ISOWeek }; } $f._q = _q; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tuple = _tuple; $f.day = day; $f.dec31wday = dec31wday; $f.jan1wday = jan1wday; $f.month = month; $f.t = t; $f.wday = wday; $f.week = week; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.ISOWeek = function() { return this.$val.ISOWeek(); };
	Time.ptr.prototype.Clock = function() {
		var _r, _r$1, _tuple, hour, min, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; hour = $f.hour; min = $f.min; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		hour = 0;
		min = 0;
		sec = 0;
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = absClock(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		hour = _tuple[0];
		min = _tuple[1];
		sec = _tuple[2];
		$s = -1; return [hour, min, sec];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Clock }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.hour = hour; $f.min = min; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Clock = function() { return this.$val.Clock(); };
	absClock = function(abs) {
		var _q, _q$1, abs, hour, min, sec;
		hour = 0;
		min = 0;
		sec = 0;
		sec = (($div64(abs, new $Uint64(0, 86400), true).$low >> 0));
		hour = (_q = sec / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(hour, 3600))) >> 0;
		min = (_q$1 = sec / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(min, 60))) >> 0;
		return [hour, min, sec];
	};
	Time.ptr.prototype.Hour = function() {
		var _q, _r, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _r = $f._r; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return (_q = (($div64(_r, new $Uint64(0, 86400), true).$low >> 0)) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Hour }; } $f._q = _q; $f._r = _r; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Hour = function() { return this.$val.Hour(); };
	Time.ptr.prototype.Minute = function() {
		var _q, _r, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _r = $f._r; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return (_q = (($div64(_r, new $Uint64(0, 3600), true).$low >> 0)) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Minute }; } $f._q = _q; $f._r = _r; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Minute = function() { return this.$val.Minute(); };
	Time.ptr.prototype.Second = function() {
		var _r, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return (($div64(_r, new $Uint64(0, 60), true).$low >> 0));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Second }; } $f._r = _r; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Second = function() { return this.$val.Second(); };
	Time.ptr.prototype.Nanosecond = function() {
		var t;
		t = this;
		return ((t.nsec() >> 0));
	};
	Time.prototype.Nanosecond = function() { return this.$val.Nanosecond(); };
	Time.ptr.prototype.YearDay = function() {
		var _r, _tuple, t, yday, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; t = $f.t; yday = $f.yday; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		yday = _tuple[3];
		$s = -1; return yday + 1 >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.YearDay }; } $f._r = _r; $f._tuple = _tuple; $f.t = t; $f.yday = yday; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.YearDay = function() { return this.$val.YearDay(); };
	Duration.prototype.String = function() {
		var _tuple, _tuple$1, buf, d, neg, prec, u, w;
		d = this;
		buf = arrayType$3.zero();
		w = 32;
		u = (new $Uint64(d.$high, d.$low));
		neg = (d.$high < 0 || (d.$high === 0 && d.$low < 0));
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000000))) {
			prec = 0;
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 115);
			w = w - (1) >> 0;
			if ((u.$high === 0 && u.$low === 0)) {
				return "0s";
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000))) {
				prec = 0;
				((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 110);
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000))) {
				prec = 3;
				w = w - (1) >> 0;
				$copyString($subslice(new sliceType$3(buf), w), "\xC2\xB5");
			} else {
				prec = 6;
				((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 109);
			}
			_tuple = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, prec);
			w = _tuple[0];
			u = _tuple[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
		} else {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 115);
			_tuple$1 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, 9);
			w = _tuple$1[0];
			u = _tuple$1[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
			u = $div64(u, (new $Uint64(0, 60)), false);
			if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 109);
				w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
				u = $div64(u, (new $Uint64(0, 60)), false);
				if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
					w = w - (1) >> 0;
					((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 104);
					w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
				}
			}
		}
		if (neg) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[w] = 45);
		}
		return ($bytesToString($subslice(new sliceType$3(buf), w)));
	};
	$ptrType(Duration).prototype.String = function() { return this.$get().String(); };
	fmtFrac = function(buf, v, prec) {
		var _tmp, _tmp$1, buf, digit, i, nv, nw, prec, print, v, w;
		nw = 0;
		nv = new $Uint64(0, 0);
		w = buf.$length;
		print = false;
		i = 0;
		while (true) {
			if (!(i < prec)) { break; }
			digit = $div64(v, new $Uint64(0, 10), true);
			print = print || !((digit.$high === 0 && digit.$low === 0));
			if (print) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = (((digit.$low << 24 >>> 24)) + 48 << 24 >>> 24));
			}
			v = $div64(v, (new $Uint64(0, 10)), false);
			i = i + (1) >> 0;
		}
		if (print) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = 46);
		}
		_tmp = w;
		_tmp$1 = v;
		nw = _tmp;
		nv = _tmp$1;
		return [nw, nv];
	};
	fmtInt = function(buf, v) {
		var buf, v, w;
		w = buf.$length;
		if ((v.$high === 0 && v.$low === 0)) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = 48);
		} else {
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = ((($div64(v, new $Uint64(0, 10), true).$low << 24 >>> 24)) + 48 << 24 >>> 24));
				v = $div64(v, (new $Uint64(0, 10)), false);
			}
		}
		return w;
	};
	Duration.prototype.Nanoseconds = function() {
		var d;
		d = this;
		return (new $Int64(d.$high, d.$low));
	};
	$ptrType(Duration).prototype.Nanoseconds = function() { return this.$get().Nanoseconds(); };
	Duration.prototype.Seconds = function() {
		var d, nsec, sec;
		d = this;
		sec = $div64(d, new Duration(0, 1000000000), false);
		nsec = $div64(d, new Duration(0, 1000000000), true);
		return ($flatten64(sec)) + ($flatten64(nsec)) / 1e+09;
	};
	$ptrType(Duration).prototype.Seconds = function() { return this.$get().Seconds(); };
	Duration.prototype.Minutes = function() {
		var d, min, nsec;
		d = this;
		min = $div64(d, new Duration(13, 4165425152), false);
		nsec = $div64(d, new Duration(13, 4165425152), true);
		return ($flatten64(min)) + ($flatten64(nsec)) / 6e+10;
	};
	$ptrType(Duration).prototype.Minutes = function() { return this.$get().Minutes(); };
	Duration.prototype.Hours = function() {
		var d, hour, nsec;
		d = this;
		hour = $div64(d, new Duration(838, 817405952), false);
		nsec = $div64(d, new Duration(838, 817405952), true);
		return ($flatten64(hour)) + ($flatten64(nsec)) / 3.6e+12;
	};
	$ptrType(Duration).prototype.Hours = function() { return this.$get().Hours(); };
	Duration.prototype.Truncate = function(m) {
		var d, m, x$1;
		d = this;
		if ((m.$high < 0 || (m.$high === 0 && m.$low <= 0))) {
			return d;
		}
		return (x$1 = $div64(d, m, true), new Duration(d.$high - x$1.$high, d.$low - x$1.$low));
	};
	$ptrType(Duration).prototype.Truncate = function(m) { return this.$get().Truncate(m); };
	lessThanHalf = function(x$1, y) {
		var x$1, x$2, x$3, x$4, x$5, y;
		return (x$2 = (x$3 = (new $Uint64(x$1.$high, x$1.$low)), x$4 = (new $Uint64(x$1.$high, x$1.$low)), new $Uint64(x$3.$high + x$4.$high, x$3.$low + x$4.$low)), x$5 = (new $Uint64(y.$high, y.$low)), (x$2.$high < x$5.$high || (x$2.$high === x$5.$high && x$2.$low < x$5.$low)));
	};
	Duration.prototype.Round = function(m) {
		var d, d1, d1$1, m, r, x$1, x$2;
		d = this;
		if ((m.$high < 0 || (m.$high === 0 && m.$low <= 0))) {
			return d;
		}
		r = $div64(d, m, true);
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 0))) {
			r = new Duration(-r.$high, -r.$low);
			if (lessThanHalf(r, m)) {
				return new Duration(d.$high + r.$high, d.$low + r.$low);
			}
			d1 = (x$1 = new Duration(d.$high - m.$high, d.$low - m.$low), new Duration(x$1.$high + r.$high, x$1.$low + r.$low));
			if ((d1.$high < d.$high || (d1.$high === d.$high && d1.$low < d.$low))) {
				return d1;
			}
			return new Duration(-2147483648, 0);
		}
		if (lessThanHalf(r, m)) {
			return new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		d1$1 = (x$2 = new Duration(d.$high + m.$high, d.$low + m.$low), new Duration(x$2.$high - r.$high, x$2.$low - r.$low));
		if ((d1$1.$high > d.$high || (d1$1.$high === d.$high && d1$1.$low > d.$low))) {
			return d1$1;
		}
		return new Duration(2147483647, 4294967295);
	};
	$ptrType(Duration).prototype.Round = function(m) { return this.$get().Round(m); };
	Time.ptr.prototype.Add = function(d) {
		var d, dsec, nsec, t, te, x$1, x$10, x$11, x$12, x$13, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		t = this;
		dsec = ((x$1 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$1.$high, x$1.$low)));
		nsec = t.nsec() + (((x$2 = $div64(d, new Duration(0, 1000000000), true), x$2.$low + ((x$2.$high >> 31) * 4294967296)) >> 0)) >> 0;
		if (nsec >= 1000000000) {
			dsec = (x$3 = new $Int64(0, 1), new $Int64(dsec.$high + x$3.$high, dsec.$low + x$3.$low));
			nsec = nsec - (1000000000) >> 0;
		} else if (nsec < 0) {
			dsec = (x$4 = new $Int64(0, 1), new $Int64(dsec.$high - x$4.$high, dsec.$low - x$4.$low));
			nsec = nsec + (1000000000) >> 0;
		}
		t.wall = (x$5 = (x$6 = t.wall, new $Uint64(x$6.$high & ~0, (x$6.$low & ~1073741823) >>> 0)), x$7 = (new $Uint64(0, nsec)), new $Uint64(x$5.$high | x$7.$high, (x$5.$low | x$7.$low) >>> 0));
		t.addSec(dsec);
		if (!((x$8 = (x$9 = t.wall, new $Uint64(x$9.$high & 2147483648, (x$9.$low & 0) >>> 0)), (x$8.$high === 0 && x$8.$low === 0)))) {
			te = (x$10 = t.ext, x$11 = (new $Int64(d.$high, d.$low)), new $Int64(x$10.$high + x$11.$high, x$10.$low + x$11.$low));
			if ((d.$high < 0 || (d.$high === 0 && d.$low < 0)) && (x$12 = t.ext, (te.$high > x$12.$high || (te.$high === x$12.$high && te.$low > x$12.$low))) || (d.$high > 0 || (d.$high === 0 && d.$low > 0)) && (x$13 = t.ext, (te.$high < x$13.$high || (te.$high === x$13.$high && te.$low < x$13.$low)))) {
				t.stripMono();
			} else {
				t.ext = te;
			}
		}
		return t;
	};
	Time.prototype.Add = function(d) { return this.$val.Add(d); };
	Time.ptr.prototype.Sub = function(u) {
		var d, d$1, t, te, u, ue, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		t = this;
		if (!((x$1 = (x$2 = (x$3 = t.wall, x$4 = u.wall, new $Uint64(x$3.$high & x$4.$high, (x$3.$low & x$4.$low) >>> 0)), new $Uint64(x$2.$high & 2147483648, (x$2.$low & 0) >>> 0)), (x$1.$high === 0 && x$1.$low === 0)))) {
			te = t.ext;
			ue = u.ext;
			d = ((x$5 = new $Int64(te.$high - ue.$high, te.$low - ue.$low), new Duration(x$5.$high, x$5.$low)));
			if ((d.$high < 0 || (d.$high === 0 && d.$low < 0)) && (te.$high > ue.$high || (te.$high === ue.$high && te.$low > ue.$low))) {
				return new Duration(2147483647, 4294967295);
			}
			if ((d.$high > 0 || (d.$high === 0 && d.$low > 0)) && (te.$high < ue.$high || (te.$high === ue.$high && te.$low < ue.$low))) {
				return new Duration(-2147483648, 0);
			}
			return d;
		}
		d$1 = (x$6 = $mul64(((x$7 = (x$8 = t.sec(), x$9 = u.sec(), new $Int64(x$8.$high - x$9.$high, x$8.$low - x$9.$low)), new Duration(x$7.$high, x$7.$low))), new Duration(0, 1000000000)), x$10 = (new Duration(0, (t.nsec() - u.nsec() >> 0))), new Duration(x$6.$high + x$10.$high, x$6.$low + x$10.$low));
		if ($clone($clone(u, Time).Add(d$1), Time).Equal($clone(t, Time))) {
			return d$1;
		} else if ($clone(t, Time).Before($clone(u, Time))) {
			return new Duration(-2147483648, 0);
		} else {
			return new Duration(2147483647, 4294967295);
		}
	};
	Time.prototype.Sub = function(u) { return this.$val.Sub(u); };
	Time.ptr.prototype.AddDate = function(years, months$1, days$1) {
		var _r, _r$1, _r$2, _tuple, _tuple$1, day, days$1, hour, min, month, months$1, sec, t, year, years, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; day = $f.day; days$1 = $f.days$1; hour = $f.hour; min = $f.min; month = $f.month; months$1 = $f.months$1; sec = $f.sec; t = $f.t; year = $f.year; years = $f.years; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).Date(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		year = _tuple[0];
		month = _tuple[1];
		day = _tuple[2];
		_r$1 = $clone(t, Time).Clock(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		hour = _tuple$1[0];
		min = _tuple$1[1];
		sec = _tuple$1[2];
		_r$2 = Date(year + years >> 0, month + ((months$1 >> 0)) >> 0, day + days$1 >> 0, hour, min, sec, ((t.nsec() >> 0)), $clone(t, Time).Location()); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AddDate }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.day = day; $f.days$1 = days$1; $f.hour = hour; $f.min = min; $f.month = month; $f.months$1 = months$1; $f.sec = sec; $f.t = t; $f.year = year; $f.years = years; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AddDate = function(years, months$1, days$1) { return this.$val.AddDate(years, months$1, days$1); };
	Time.ptr.prototype.date = function(full) {
		var _r, _r$1, _tuple, day, full, month, t, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; day = $f.day; full = $f.full; month = $f.month; t = $f.t; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		t = this;
		_r = $clone(t, Time).abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = absDate(_r, full); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		year = _tuple[0];
		month = _tuple[1];
		day = _tuple[2];
		yday = _tuple[3];
		$s = -1; return [year, month, day, yday];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.date }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.day = day; $f.full = full; $f.month = month; $f.t = t; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.date = function(full) { return this.$val.date(full); };
	absDate = function(abs, full) {
		var _q, abs, begin, d, day, end, full, month, n, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, yday, year;
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		d = $div64(abs, new $Uint64(0, 86400), false);
		n = $div64(d, new $Uint64(0, 146097), false);
		y = $mul64(new $Uint64(0, 400), n);
		d = (x$1 = $mul64(new $Uint64(0, 146097), n), new $Uint64(d.$high - x$1.$high, d.$low - x$1.$low));
		n = $div64(d, new $Uint64(0, 36524), false);
		n = (x$2 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$2.$high, n.$low - x$2.$low));
		y = (x$3 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high + x$3.$high, y.$low + x$3.$low));
		d = (x$4 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high - x$4.$high, d.$low - x$4.$low));
		n = $div64(d, new $Uint64(0, 1461), false);
		y = (x$5 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high + x$5.$high, y.$low + x$5.$low));
		d = (x$6 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high - x$6.$high, d.$low - x$6.$low));
		n = $div64(d, new $Uint64(0, 365), false);
		n = (x$7 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$7.$high, n.$low - x$7.$low));
		y = (x$8 = n, new $Uint64(y.$high + x$8.$high, y.$low + x$8.$low));
		d = (x$9 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high - x$9.$high, d.$low - x$9.$low));
		year = (((x$10 = (x$11 = (new $Int64(y.$high, y.$low)), new $Int64(x$11.$high + -69, x$11.$low + 4075721025)), x$10.$low + ((x$10.$high >> 31) * 4294967296)) >> 0));
		yday = ((d.$low >> 0));
		if (!full) {
			return [year, month, day, yday];
		}
		day = yday;
		if (isLeap(year)) {
			if (day > 59) {
				day = day - (1) >> 0;
			} else if ((day === 59)) {
				month = 2;
				day = 29;
				return [year, month, day, yday];
			}
		}
		month = (((_q = day / 31, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0));
		end = (((x$12 = month + 1 >> 0, ((x$12 < 0 || x$12 >= daysBefore.length) ? ($throwRuntimeError("index out of range"), undefined) : daysBefore[x$12])) >> 0));
		begin = 0;
		if (day >= end) {
			month = month + (1) >> 0;
			begin = end;
		} else {
			begin = ((((month < 0 || month >= daysBefore.length) ? ($throwRuntimeError("index out of range"), undefined) : daysBefore[month]) >> 0));
		}
		month = month + (1) >> 0;
		day = (day - begin >> 0) + 1 >> 0;
		return [year, month, day, yday];
	};
	daysIn = function(m, year) {
		var m, x$1, year;
		if ((m === 2) && isLeap(year)) {
			return 29;
		}
		return (((((m < 0 || m >= daysBefore.length) ? ($throwRuntimeError("index out of range"), undefined) : daysBefore[m]) - (x$1 = m - 1 >> 0, ((x$1 < 0 || x$1 >= daysBefore.length) ? ($throwRuntimeError("index out of range"), undefined) : daysBefore[x$1])) >> 0) >> 0));
	};
	unixTime = function(sec, nsec) {
		var nsec, sec;
		return new Time.ptr((new $Uint64(0, nsec)), new $Int64(sec.$high + 14, sec.$low + 2006054656), $pkg.Local);
	};
	Time.ptr.prototype.UTC = function() {
		var t;
		t = this;
		t.setLoc(utcLoc);
		return t;
	};
	Time.prototype.UTC = function() { return this.$val.UTC(); };
	Time.ptr.prototype.Local = function() {
		var t;
		t = this;
		t.setLoc($pkg.Local);
		return t;
	};
	Time.prototype.Local = function() { return this.$val.Local(); };
	Time.ptr.prototype.In = function(loc) {
		var loc, t;
		t = this;
		if (loc === ptrType$2.nil) {
			$panic(new $String("time: missing Location in call to Time.In"));
		}
		t.setLoc(loc);
		return t;
	};
	Time.prototype.In = function(loc) { return this.$val.In(loc); };
	Time.ptr.prototype.Location = function() {
		var l, t;
		t = this;
		l = t.loc;
		if (l === ptrType$2.nil) {
			l = $pkg.UTC;
		}
		return l;
	};
	Time.prototype.Location = function() { return this.$val.Location(); };
	Time.ptr.prototype.Zone = function() {
		var _r, _tuple, name, offset, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; name = $f.name; offset = $f.offset; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		t = this;
		_r = t.loc.lookup(t.unixSec()); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		name = _tuple[0];
		offset = _tuple[1];
		$s = -1; return [name, offset];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Zone }; } $f._r = _r; $f._tuple = _tuple; $f.name = name; $f.offset = offset; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Zone = function() { return this.$val.Zone(); };
	Time.ptr.prototype.Unix = function() {
		var t;
		t = this;
		return t.unixSec();
	};
	Time.prototype.Unix = function() { return this.$val.Unix(); };
	Time.ptr.prototype.UnixNano = function() {
		var t, x$1, x$2;
		t = this;
		return (x$1 = $mul64((t.unixSec()), new $Int64(0, 1000000000)), x$2 = (new $Int64(0, t.nsec())), new $Int64(x$1.$high + x$2.$high, x$1.$low + x$2.$low));
	};
	Time.prototype.UnixNano = function() { return this.$val.UnixNano(); };
	Time.ptr.prototype.MarshalBinary = function() {
		var _q, _r, _r$1, _tuple, enc, nsec, offset, offsetMin, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; enc = $f.enc; nsec = $f.nsec; offset = $f.offset; offsetMin = $f.offsetMin; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		offsetMin = 0;
		/* */ if ($clone(t, Time).Location() === $pkg.UTC) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($clone(t, Time).Location() === $pkg.UTC) { */ case 1:
			offsetMin = -1;
			$s = 3; continue;
		/* } else { */ case 2:
			_r = $clone(t, Time).Zone(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			offset = _tuple[1];
			if (!(((_r$1 = offset % 60, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0))) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
			}
			offset = (_q = offset / (60), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			if (offset < -32768 || (offset === -1) || offset > 32767) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
			}
			offsetMin = ((offset << 16 >> 16));
		/* } */ case 3:
		sec = t.sec();
		nsec = t.nsec();
		enc = new sliceType$3([1, (($shiftRightInt64(sec, 56).$low << 24 >>> 24)), (($shiftRightInt64(sec, 48).$low << 24 >>> 24)), (($shiftRightInt64(sec, 40).$low << 24 >>> 24)), (($shiftRightInt64(sec, 32).$low << 24 >>> 24)), (($shiftRightInt64(sec, 24).$low << 24 >>> 24)), (($shiftRightInt64(sec, 16).$low << 24 >>> 24)), (($shiftRightInt64(sec, 8).$low << 24 >>> 24)), ((sec.$low << 24 >>> 24)), (((nsec >> 24 >> 0) << 24 >>> 24)), (((nsec >> 16 >> 0) << 24 >>> 24)), (((nsec >> 8 >> 0) << 24 >>> 24)), ((nsec << 24 >>> 24)), (((offsetMin >> 8 << 16 >> 16) << 24 >>> 24)), ((offsetMin << 24 >>> 24))]);
		$s = -1; return [enc, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalBinary }; } $f._q = _q; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.enc = enc; $f.nsec = nsec; $f.offset = offset; $f.offsetMin = offsetMin; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalBinary = function() { return this.$val.MarshalBinary(); };
	Time.ptr.prototype.UnmarshalBinary = function(data) {
		var _r, _tuple, buf, data, localoff, nsec, offset, sec, t, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; buf = $f.buf; data = $f.data; localoff = $f.localoff; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; t = $f.t; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		buf = data;
		if (buf.$length === 0) {
			$s = -1; return errors.New("Time.UnmarshalBinary: no data");
		}
		if (!(((0 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 0]) === 1))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: unsupported version");
		}
		if (!((buf.$length === 15))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: invalid length");
		}
		buf = $subslice(buf, 1);
		sec = (x$1 = (x$2 = (x$3 = (x$4 = (x$5 = (x$6 = (x$7 = (new $Int64(0, (7 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 7]))), x$8 = $shiftLeft64((new $Int64(0, (6 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 6]))), 8), new $Int64(x$7.$high | x$8.$high, (x$7.$low | x$8.$low) >>> 0)), x$9 = $shiftLeft64((new $Int64(0, (5 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 5]))), 16), new $Int64(x$6.$high | x$9.$high, (x$6.$low | x$9.$low) >>> 0)), x$10 = $shiftLeft64((new $Int64(0, (4 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 4]))), 24), new $Int64(x$5.$high | x$10.$high, (x$5.$low | x$10.$low) >>> 0)), x$11 = $shiftLeft64((new $Int64(0, (3 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 3]))), 32), new $Int64(x$4.$high | x$11.$high, (x$4.$low | x$11.$low) >>> 0)), x$12 = $shiftLeft64((new $Int64(0, (2 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 2]))), 40), new $Int64(x$3.$high | x$12.$high, (x$3.$low | x$12.$low) >>> 0)), x$13 = $shiftLeft64((new $Int64(0, (1 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 1]))), 48), new $Int64(x$2.$high | x$13.$high, (x$2.$low | x$13.$low) >>> 0)), x$14 = $shiftLeft64((new $Int64(0, (0 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 0]))), 56), new $Int64(x$1.$high | x$14.$high, (x$1.$low | x$14.$low) >>> 0));
		buf = $subslice(buf, 8);
		nsec = (((((3 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 3]) >> 0)) | ((((2 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 2]) >> 0)) << 8 >> 0)) | ((((1 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 1]) >> 0)) << 16 >> 0)) | ((((0 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 0]) >> 0)) << 24 >> 0);
		buf = $subslice(buf, 4);
		offset = $imul(((((((1 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 1]) << 16 >> 16)) | ((((0 >= buf.$length ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + 0]) << 16 >> 16)) << 8 << 16 >> 16)) >> 0)), 60);
		Time.copy(t, new Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$2.nil));
		t.wall = (new $Uint64(0, nsec));
		t.ext = sec;
		/* */ if (offset === -60) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (offset === -60) { */ case 1:
			t.setLoc(utcLoc);
			$s = 3; continue;
		/* } else { */ case 2:
			_r = $pkg.Local.lookup(t.unixSec()); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			localoff = _tuple[1];
			if (offset === localoff) {
				t.setLoc($pkg.Local);
			} else {
				t.setLoc(FixedZone("", offset));
			}
		/* } */ case 3:
		$s = -1; return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalBinary }; } $f._r = _r; $f._tuple = _tuple; $f.buf = buf; $f.data = data; $f.localoff = localoff; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalBinary = function(data) { return this.$val.UnmarshalBinary(data); };
	Time.ptr.prototype.GobEncode = function() {
		var _r, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).MarshalBinary(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobEncode }; } $f._r = _r; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobEncode = function() { return this.$val.GobEncode(); };
	Time.ptr.prototype.GobDecode = function(data) {
		var _r, data, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; data = $f.data; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = t.UnmarshalBinary(data); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobDecode }; } $f._r = _r; $f.data = data; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobDecode = function(data) { return this.$val.GobDecode(data); };
	Time.ptr.prototype.MarshalJSON = function() {
		var _r, _r$1, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		y = _r;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 37);
		b = $append(b, 34);
		_r$1 = $clone(t, Time).AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		b = $append(b, 34);
		$s = -1; return [b, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalJSON }; } $f._r = _r; $f._r$1 = _r$1; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalJSON = function() { return this.$val.MarshalJSON(); };
	Time.ptr.prototype.UnmarshalJSON = function(data) {
		var _r, _tuple, data, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; data = $f.data; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (($bytesToString(data)) === "null") {
			$s = -1; return $ifaceNil;
		}
		err = $ifaceNil;
		_r = Parse("\"2006-01-02T15:04:05Z07:00\"", ($bytesToString(data))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		Time.copy(t, _tuple[0]);
		err = _tuple[1];
		$s = -1; return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalJSON }; } $f._r = _r; $f._tuple = _tuple; $f.data = data; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalJSON = function(data) { return this.$val.UnmarshalJSON(data); };
	Time.ptr.prototype.MarshalText = function() {
		var _r, _r$1, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = $clone(t, Time).Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		y = _r;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 35);
		_r$1 = $clone(t, Time).AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return [_r$1, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalText }; } $f._r = _r; $f._r$1 = _r$1; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalText = function() { return this.$val.MarshalText(); };
	Time.ptr.prototype.UnmarshalText = function(data) {
		var _r, _tuple, data, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; data = $f.data; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		err = $ifaceNil;
		_r = Parse("2006-01-02T15:04:05Z07:00", ($bytesToString(data))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		Time.copy(t, _tuple[0]);
		err = _tuple[1];
		$s = -1; return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalText }; } $f._r = _r; $f._tuple = _tuple; $f.data = data; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalText = function(data) { return this.$val.UnmarshalText(data); };
	Unix = function(sec, nsec) {
		var n, nsec, sec, x$1, x$2, x$3, x$4;
		if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0)) || (nsec.$high > 0 || (nsec.$high === 0 && nsec.$low >= 1000000000))) {
			n = $div64(nsec, new $Int64(0, 1000000000), false);
			sec = (x$1 = n, new $Int64(sec.$high + x$1.$high, sec.$low + x$1.$low));
			nsec = (x$2 = $mul64(n, new $Int64(0, 1000000000)), new $Int64(nsec.$high - x$2.$high, nsec.$low - x$2.$low));
			if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0))) {
				nsec = (x$3 = new $Int64(0, 1000000000), new $Int64(nsec.$high + x$3.$high, nsec.$low + x$3.$low));
				sec = (x$4 = new $Int64(0, 1), new $Int64(sec.$high - x$4.$high, sec.$low - x$4.$low));
			}
		}
		return unixTime(sec, (((nsec.$low + ((nsec.$high >> 31) * 4294967296)) >> 0)));
	};
	$pkg.Unix = Unix;
	isLeap = function(year) {
		var _r, _r$1, _r$2, year;
		return ((_r = year % 4, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0) && (!(((_r$1 = year % 100, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0)) || ((_r$2 = year % 400, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0));
	};
	norm = function(hi, lo, base) {
		var _q, _q$1, _tmp, _tmp$1, base, hi, lo, n, n$1, nhi, nlo;
		nhi = 0;
		nlo = 0;
		if (lo < 0) {
			n = (_q = ((-lo - 1 >> 0)) / base, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) + 1 >> 0;
			hi = hi - (n) >> 0;
			lo = lo + (($imul(n, base))) >> 0;
		}
		if (lo >= base) {
			n$1 = (_q$1 = lo / base, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			hi = hi + (n$1) >> 0;
			lo = lo - (($imul(n$1, base))) >> 0;
		}
		_tmp = hi;
		_tmp$1 = lo;
		nhi = _tmp;
		nlo = _tmp$1;
		return [nhi, nlo];
	};
	Date = function(year, month, day, hour, min, sec, nsec, loc) {
		var _r, _r$1, _r$2, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, abs, d, day, end, hour, loc, m, min, month, n, nsec, offset, sec, start, t, unix, utc, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; abs = $f.abs; d = $f.d; day = $f.day; end = $f.end; hour = $f.hour; loc = $f.loc; m = $f.m; min = $f.min; month = $f.month; n = $f.n; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; start = $f.start; t = $f.t; unix = $f.unix; utc = $f.utc; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$16 = $f.x$16; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; y = $f.y; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (loc === ptrType$2.nil) {
			$panic(new $String("time: missing Location in call to Date"));
		}
		m = ((month >> 0)) - 1 >> 0;
		_tuple = norm(year, m, 12);
		year = _tuple[0];
		m = _tuple[1];
		month = ((m >> 0)) + 1 >> 0;
		_tuple$1 = norm(sec, nsec, 1000000000);
		sec = _tuple$1[0];
		nsec = _tuple$1[1];
		_tuple$2 = norm(min, sec, 60);
		min = _tuple$2[0];
		sec = _tuple$2[1];
		_tuple$3 = norm(hour, min, 60);
		hour = _tuple$3[0];
		min = _tuple$3[1];
		_tuple$4 = norm(day, hour, 24);
		day = _tuple$4[0];
		hour = _tuple$4[1];
		y = ((x$1 = (x$2 = (new $Int64(0, year)), new $Int64(x$2.$high - -69, x$2.$low - 4075721025)), new $Uint64(x$1.$high, x$1.$low)));
		n = $div64(y, new $Uint64(0, 400), false);
		y = (x$3 = $mul64(new $Uint64(0, 400), n), new $Uint64(y.$high - x$3.$high, y.$low - x$3.$low));
		d = $mul64(new $Uint64(0, 146097), n);
		n = $div64(y, new $Uint64(0, 100), false);
		y = (x$4 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high - x$4.$high, y.$low - x$4.$low));
		d = (x$5 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high + x$5.$high, d.$low + x$5.$low));
		n = $div64(y, new $Uint64(0, 4), false);
		y = (x$6 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high - x$6.$high, y.$low - x$6.$low));
		d = (x$7 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high + x$7.$high, d.$low + x$7.$low));
		n = y;
		d = (x$8 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high + x$8.$high, d.$low + x$8.$low));
		d = (x$9 = (new $Uint64(0, (x$10 = month - 1 >> 0, ((x$10 < 0 || x$10 >= daysBefore.length) ? ($throwRuntimeError("index out of range"), undefined) : daysBefore[x$10])))), new $Uint64(d.$high + x$9.$high, d.$low + x$9.$low));
		if (isLeap(year) && month >= 3) {
			d = (x$11 = new $Uint64(0, 1), new $Uint64(d.$high + x$11.$high, d.$low + x$11.$low));
		}
		d = (x$12 = (new $Uint64(0, (day - 1 >> 0))), new $Uint64(d.$high + x$12.$high, d.$low + x$12.$low));
		abs = $mul64(d, new $Uint64(0, 86400));
		abs = (x$13 = (new $Uint64(0, ((($imul(hour, 3600)) + ($imul(min, 60)) >> 0) + sec >> 0))), new $Uint64(abs.$high + x$13.$high, abs.$low + x$13.$low));
		unix = (x$14 = (new $Int64(abs.$high, abs.$low)), new $Int64(x$14.$high + -2147483647, x$14.$low + 3844486912));
		_r = loc.lookup(unix); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$5 = _r;
		offset = _tuple$5[1];
		start = _tuple$5[2];
		end = _tuple$5[3];
		/* */ if (!((offset === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((offset === 0))) { */ case 2:
				utc = (x$15 = (new $Int64(0, offset)), new $Int64(unix.$high - x$15.$high, unix.$low - x$15.$low));
				/* */ if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { $s = 5; continue; }
				/* */ if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { */ case 5:
					_r$1 = loc.lookup(new $Int64(start.$high - 0, start.$low - 1)); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple$6 = _r$1;
					offset = _tuple$6[1];
					$s = 7; continue;
				/* } else if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { */ case 6:
					_r$2 = loc.lookup(end); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$7 = _r$2;
					offset = _tuple$7[1];
				/* } */ case 7:
			case 4:
			unix = (x$16 = (new $Int64(0, offset)), new $Int64(unix.$high - x$16.$high, unix.$low - x$16.$low));
		/* } */ case 3:
		t = $clone(unixTime(unix, ((nsec >> 0))), Time);
		t.setLoc(loc);
		$s = -1; return t;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Date }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f.abs = abs; $f.d = d; $f.day = day; $f.end = end; $f.hour = hour; $f.loc = loc; $f.m = m; $f.min = min; $f.month = month; $f.n = n; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.start = start; $f.t = t; $f.unix = unix; $f.utc = utc; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$16 = x$16; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.y = y; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Date = Date;
	Time.ptr.prototype.Truncate = function(d) {
		var _tuple, d, r, t;
		t = this;
		t.stripMono();
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple = div($clone(t, Time), d);
		r = _tuple[1];
		return $clone(t, Time).Add(new Duration(-r.$high, -r.$low));
	};
	Time.prototype.Truncate = function(d) { return this.$val.Truncate(d); };
	Time.ptr.prototype.Round = function(d) {
		var _tuple, d, r, t;
		t = this;
		t.stripMono();
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple = div($clone(t, Time), d);
		r = _tuple[1];
		if (lessThanHalf(r, d)) {
			return $clone(t, Time).Add(new Duration(-r.$high, -r.$low));
		}
		return $clone(t, Time).Add(new Duration(d.$high - r.$high, d.$low - r.$low));
	};
	Time.prototype.Round = function(d) { return this.$val.Round(d); };
	div = function(t, d) {
		var _q, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, d, d0, d1, d1$1, neg, nsec, qmod2, r, sec, sec$1, t, tmp, u0, u0x, u1, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		qmod2 = 0;
		r = new Duration(0, 0);
		neg = false;
		nsec = t.nsec();
		sec = t.sec();
		if ((sec.$high < 0 || (sec.$high === 0 && sec.$low < 0))) {
			neg = true;
			sec = new $Int64(-sec.$high, -sec.$low);
			nsec = -nsec;
			if (nsec < 0) {
				nsec = nsec + (1000000000) >> 0;
				sec = (x$1 = new $Int64(0, 1), new $Int64(sec.$high - x$1.$high, sec.$low - x$1.$low));
			}
		}
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 1000000000)) && (x$2 = $div64(new Duration(0, 1000000000), (new Duration(d.$high + d.$high, d.$low + d.$low)), true), (x$2.$high === 0 && x$2.$low === 0))) {
			qmod2 = (((_q = nsec / (((d.$low + ((d.$high >> 31) * 4294967296)) >> 0)), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0)) & 1;
			r = (new Duration(0, (_r = nsec % (((d.$low + ((d.$high >> 31) * 4294967296)) >> 0)), _r === _r ? _r : $throwRuntimeError("integer divide by zero"))));
		} else if ((x$3 = $div64(d, new Duration(0, 1000000000), true), (x$3.$high === 0 && x$3.$low === 0))) {
			d1 = ((x$4 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$4.$high, x$4.$low)));
			qmod2 = (((x$5 = $div64(sec, d1, false), x$5.$low + ((x$5.$high >> 31) * 4294967296)) >> 0)) & 1;
			r = (x$6 = $mul64(((x$7 = $div64(sec, d1, true), new Duration(x$7.$high, x$7.$low))), new Duration(0, 1000000000)), x$8 = (new Duration(0, nsec)), new Duration(x$6.$high + x$8.$high, x$6.$low + x$8.$low));
		} else {
			sec$1 = (new $Uint64(sec.$high, sec.$low));
			tmp = $mul64(($shiftRightUint64(sec$1, 32)), new $Uint64(0, 1000000000));
			u1 = $shiftRightUint64(tmp, 32);
			u0 = $shiftLeft64(tmp, 32);
			tmp = $mul64((new $Uint64(sec$1.$high & 0, (sec$1.$low & 4294967295) >>> 0)), new $Uint64(0, 1000000000));
			_tmp = u0;
			_tmp$1 = new $Uint64(u0.$high + tmp.$high, u0.$low + tmp.$low);
			u0x = _tmp;
			u0 = _tmp$1;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$9 = new $Uint64(0, 1), new $Uint64(u1.$high + x$9.$high, u1.$low + x$9.$low));
			}
			_tmp$2 = u0;
			_tmp$3 = (x$10 = (new $Uint64(0, nsec)), new $Uint64(u0.$high + x$10.$high, u0.$low + x$10.$low));
			u0x = _tmp$2;
			u0 = _tmp$3;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$11 = new $Uint64(0, 1), new $Uint64(u1.$high + x$11.$high, u1.$low + x$11.$low));
			}
			d1$1 = (new $Uint64(d.$high, d.$low));
			while (true) {
				if (!(!((x$12 = $shiftRightUint64(d1$1, 63), (x$12.$high === 0 && x$12.$low === 1))))) { break; }
				d1$1 = $shiftLeft64(d1$1, (1));
			}
			d0 = new $Uint64(0, 0);
			while (true) {
				qmod2 = 0;
				if ((u1.$high > d1$1.$high || (u1.$high === d1$1.$high && u1.$low > d1$1.$low)) || (u1.$high === d1$1.$high && u1.$low === d1$1.$low) && (u0.$high > d0.$high || (u0.$high === d0.$high && u0.$low >= d0.$low))) {
					qmod2 = 1;
					_tmp$4 = u0;
					_tmp$5 = new $Uint64(u0.$high - d0.$high, u0.$low - d0.$low);
					u0x = _tmp$4;
					u0 = _tmp$5;
					if ((u0.$high > u0x.$high || (u0.$high === u0x.$high && u0.$low > u0x.$low))) {
						u1 = (x$13 = new $Uint64(0, 1), new $Uint64(u1.$high - x$13.$high, u1.$low - x$13.$low));
					}
					u1 = (x$14 = d1$1, new $Uint64(u1.$high - x$14.$high, u1.$low - x$14.$low));
				}
				if ((d1$1.$high === 0 && d1$1.$low === 0) && (x$15 = (new $Uint64(d.$high, d.$low)), (d0.$high === x$15.$high && d0.$low === x$15.$low))) {
					break;
				}
				d0 = $shiftRightUint64(d0, (1));
				d0 = (x$16 = $shiftLeft64((new $Uint64(d1$1.$high & 0, (d1$1.$low & 1) >>> 0)), 63), new $Uint64(d0.$high | x$16.$high, (d0.$low | x$16.$low) >>> 0));
				d1$1 = $shiftRightUint64(d1$1, (1));
			}
			r = (new Duration(u0.$high, u0.$low));
		}
		if (neg && !((r.$high === 0 && r.$low === 0))) {
			qmod2 = (qmod2 ^ (1)) >> 0;
			r = new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		return [qmod2, r];
	};
	Location.ptr.prototype.get = function() {
		var l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		if (l === ptrType$2.nil) {
			$s = -1; return utcLoc;
		}
		/* */ if (l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === localLoc) { */ case 1:
			$r = localOnce.Do(initLocal); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$s = -1; return l;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.get }; } $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.get = function() { return this.$val.get(); };
	Location.ptr.prototype.String = function() {
		var _r, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		_r = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r.name;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.String }; } $f._r = _r; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.String = function() { return this.$val.String(); };
	FixedZone = function(name, offset) {
		var l, name, offset, x$1;
		l = new Location.ptr(name, new sliceType([new zone.ptr(name, offset, false)]), new sliceType$1([new zoneTrans.ptr(new $Int64(-2147483648, 0), 0, false, false)]), new $Int64(-2147483648, 0), new $Int64(2147483647, 4294967295), ptrType.nil);
		l.cacheZone = (x$1 = l.zone, (0 >= x$1.$length ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + 0]));
		return l;
	};
	$pkg.FixedZone = FixedZone;
	Location.ptr.prototype.lookup = function(sec) {
		var _q, _r, end, hi, l, lim, lo, m, name, offset, sec, start, tx, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, zone$1, zone$2, zone$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _r = $f._r; end = $f.end; hi = $f.hi; l = $f.l; lim = $f.lim; lo = $f.lo; m = $f.m; name = $f.name; offset = $f.offset; sec = $f.sec; start = $f.start; tx = $f.tx; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; zone$1 = $f.zone$1; zone$2 = $f.zone$2; zone$3 = $f.zone$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		start = new $Int64(0, 0);
		end = new $Int64(0, 0);
		l = this;
		_r = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		l = _r;
		if (l.zone.$length === 0) {
			name = "UTC";
			offset = 0;
			start = new $Int64(-2147483648, 0);
			end = new $Int64(2147483647, 4294967295);
			$s = -1; return [name, offset, start, end];
		}
		zone$1 = l.cacheZone;
		if (!(zone$1 === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) {
			name = zone$1.name;
			offset = zone$1.offset;
			start = l.cacheStart;
			end = l.cacheEnd;
			$s = -1; return [name, offset, start, end];
		}
		if ((l.tx.$length === 0) || (x$3 = (x$4 = l.tx, (0 >= x$4.$length ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + 0])).when, (sec.$high < x$3.$high || (sec.$high === x$3.$high && sec.$low < x$3.$low)))) {
			zone$2 = (x$5 = l.zone, x$6 = l.lookupFirstZone(), ((x$6 < 0 || x$6 >= x$5.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$5.$array[x$5.$offset + x$6]));
			name = zone$2.name;
			offset = zone$2.offset;
			start = new $Int64(-2147483648, 0);
			if (l.tx.$length > 0) {
				end = (x$7 = l.tx, (0 >= x$7.$length ? ($throwRuntimeError("index out of range"), undefined) : x$7.$array[x$7.$offset + 0])).when;
			} else {
				end = new $Int64(2147483647, 4294967295);
			}
			$s = -1; return [name, offset, start, end];
		}
		tx = l.tx;
		end = new $Int64(2147483647, 4294967295);
		lo = 0;
		hi = tx.$length;
		while (true) {
			if (!((hi - lo >> 0) > 1)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			lim = ((m < 0 || m >= tx.$length) ? ($throwRuntimeError("index out of range"), undefined) : tx.$array[tx.$offset + m]).when;
			if ((sec.$high < lim.$high || (sec.$high === lim.$high && sec.$low < lim.$low))) {
				end = lim;
				hi = m;
			} else {
				lo = m;
			}
		}
		zone$3 = (x$8 = l.zone, x$9 = ((lo < 0 || lo >= tx.$length) ? ($throwRuntimeError("index out of range"), undefined) : tx.$array[tx.$offset + lo]).index, ((x$9 < 0 || x$9 >= x$8.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$8.$array[x$8.$offset + x$9]));
		name = zone$3.name;
		offset = zone$3.offset;
		start = ((lo < 0 || lo >= tx.$length) ? ($throwRuntimeError("index out of range"), undefined) : tx.$array[tx.$offset + lo]).when;
		$s = -1; return [name, offset, start, end];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookup }; } $f._q = _q; $f._r = _r; $f.end = end; $f.hi = hi; $f.l = l; $f.lim = lim; $f.lo = lo; $f.m = m; $f.name = name; $f.offset = offset; $f.sec = sec; $f.start = start; $f.tx = tx; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.zone$3 = zone$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookup = function(sec) { return this.$val.lookup(sec); };
	Location.ptr.prototype.lookupFirstZone = function() {
		var _i, _ref, l, x$1, x$2, x$3, x$4, x$5, x$6, zi, zi$1;
		l = this;
		if (!l.firstZoneUsed()) {
			return 0;
		}
		if (l.tx.$length > 0 && (x$1 = l.zone, x$2 = (x$3 = l.tx, (0 >= x$3.$length ? ($throwRuntimeError("index out of range"), undefined) : x$3.$array[x$3.$offset + 0])).index, ((x$2 < 0 || x$2 >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + x$2])).isDST) {
			zi = (((x$4 = l.tx, (0 >= x$4.$length ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + 0])).index >> 0)) - 1 >> 0;
			while (true) {
				if (!(zi >= 0)) { break; }
				if (!(x$5 = l.zone, ((zi < 0 || zi >= x$5.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$5.$array[x$5.$offset + zi])).isDST) {
					return zi;
				}
				zi = zi - (1) >> 0;
			}
		}
		_ref = l.zone;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			zi$1 = _i;
			if (!(x$6 = l.zone, ((zi$1 < 0 || zi$1 >= x$6.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$6.$array[x$6.$offset + zi$1])).isDST) {
				return zi$1;
			}
			_i++;
		}
		return 0;
	};
	Location.prototype.lookupFirstZone = function() { return this.$val.lookupFirstZone(); };
	Location.ptr.prototype.firstZoneUsed = function() {
		var _i, _ref, l, tx;
		l = this;
		_ref = l.tx;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			tx = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), zoneTrans);
			if (tx.index === 0) {
				return true;
			}
			_i++;
		}
		return false;
	};
	Location.prototype.firstZoneUsed = function() { return this.$val.firstZoneUsed(); };
	Location.ptr.prototype.lookupName = function(name, unix) {
		var _i, _i$1, _r, _r$1, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, i, i$1, l, nam, name, offset, offset$1, ok, unix, x$1, x$2, x$3, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; i = $f.i; i$1 = $f.i$1; l = $f.l; nam = $f.nam; name = $f.name; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; unix = $f.unix; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		offset = 0;
		ok = false;
		l = this;
		_r = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		l = _r;
		_ref = l.zone;
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			zone$1 = (x$1 = l.zone, ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i]));
			/* */ if (zone$1.name === name) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (zone$1.name === name) { */ case 4:
				_r$1 = l.lookup((x$2 = (new $Int64(0, zone$1.offset)), new $Int64(unix.$high - x$2.$high, unix.$low - x$2.$low))); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple = _r$1;
				nam = _tuple[0];
				offset$1 = _tuple[1];
				if (nam === zone$1.name) {
					_tmp = offset$1;
					_tmp$1 = true;
					offset = _tmp;
					ok = _tmp$1;
					$s = -1; return [offset, ok];
				}
			/* } */ case 5:
			_i++;
		/* } */ $s = 2; continue; case 3:
		_ref$1 = l.zone;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			zone$2 = (x$3 = l.zone, ((i$1 < 0 || i$1 >= x$3.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$3.$array[x$3.$offset + i$1]));
			if (zone$2.name === name) {
				_tmp$2 = zone$2.offset;
				_tmp$3 = true;
				offset = _tmp$2;
				ok = _tmp$3;
				$s = -1; return [offset, ok];
			}
			_i$1++;
		}
		$s = -1; return [offset, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookupName }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.i = i; $f.i$1 = i$1; $f.l = l; $f.nam = nam; $f.name = name; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.unix = unix; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookupName = function(name, unix) { return this.$val.lookupName(name, unix); };
	ptrType$4.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Time.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Format", name: "Format", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "AppendFormat", name: "AppendFormat", pkg: "", typ: $funcType([sliceType$3, $String], [sliceType$3], false)}, {prop: "After", name: "After", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Before", name: "Before", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Equal", name: "Equal", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "IsZero", name: "IsZero", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "abs", name: "abs", pkg: "time", typ: $funcType([], [$Uint64], false)}, {prop: "locabs", name: "locabs", pkg: "time", typ: $funcType([], [$String, $Int, $Uint64], false)}, {prop: "Date", name: "Date", pkg: "", typ: $funcType([], [$Int, Month, $Int], false)}, {prop: "Year", name: "Year", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Month", name: "Month", pkg: "", typ: $funcType([], [Month], false)}, {prop: "Day", name: "Day", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Weekday", name: "Weekday", pkg: "", typ: $funcType([], [Weekday], false)}, {prop: "ISOWeek", name: "ISOWeek", pkg: "", typ: $funcType([], [$Int, $Int], false)}, {prop: "Clock", name: "Clock", pkg: "", typ: $funcType([], [$Int, $Int, $Int], false)}, {prop: "Hour", name: "Hour", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Minute", name: "Minute", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Second", name: "Second", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Nanosecond", name: "Nanosecond", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "YearDay", name: "YearDay", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Time], [Duration], false)}, {prop: "AddDate", name: "AddDate", pkg: "", typ: $funcType([$Int, $Int, $Int], [Time], false)}, {prop: "date", name: "date", pkg: "time", typ: $funcType([$Bool], [$Int, Month, $Int, $Int], false)}, {prop: "UTC", name: "UTC", pkg: "", typ: $funcType([], [Time], false)}, {prop: "Local", name: "Local", pkg: "", typ: $funcType([], [Time], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([ptrType$2], [Time], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$2], false)}, {prop: "Zone", name: "Zone", pkg: "", typ: $funcType([], [$String, $Int], false)}, {prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "UnixNano", name: "UnixNano", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "MarshalBinary", name: "MarshalBinary", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "GobEncode", name: "GobEncode", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Time], false)}];
	ptrType$7.methods = [{prop: "nsec", name: "nsec", pkg: "time", typ: $funcType([], [$Int32], false)}, {prop: "sec", name: "sec", pkg: "time", typ: $funcType([], [$Int64], false)}, {prop: "unixSec", name: "unixSec", pkg: "time", typ: $funcType([], [$Int64], false)}, {prop: "addSec", name: "addSec", pkg: "time", typ: $funcType([$Int64], [], false)}, {prop: "setLoc", name: "setLoc", pkg: "time", typ: $funcType([ptrType$2], [], false)}, {prop: "stripMono", name: "stripMono", pkg: "time", typ: $funcType([], [], false)}, {prop: "setMono", name: "setMono", pkg: "time", typ: $funcType([$Int64], [], false)}, {prop: "mono", name: "mono", pkg: "time", typ: $funcType([], [$Int64], false)}, {prop: "UnmarshalBinary", name: "UnmarshalBinary", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "GobDecode", name: "GobDecode", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType$3], [$error], false)}];
	Month.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Weekday.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Duration.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Nanoseconds", name: "Nanoseconds", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seconds", name: "Seconds", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Minutes", name: "Minutes", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Hours", name: "Hours", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Duration], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Duration], false)}];
	ptrType$2.methods = [{prop: "get", name: "get", pkg: "time", typ: $funcType([], [ptrType$2], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "lookup", name: "lookup", pkg: "time", typ: $funcType([$Int64], [$String, $Int, $Int64, $Int64], false)}, {prop: "lookupFirstZone", name: "lookupFirstZone", pkg: "time", typ: $funcType([], [$Int], false)}, {prop: "firstZoneUsed", name: "firstZoneUsed", pkg: "time", typ: $funcType([], [$Bool], false)}, {prop: "lookupName", name: "lookupName", pkg: "time", typ: $funcType([$String, $Int64], [$Int, $Bool], false)}];
	ParseError.init("", [{prop: "Layout", name: "Layout", embedded: false, exported: true, typ: $String, tag: ""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: ""}, {prop: "LayoutElem", name: "LayoutElem", embedded: false, exported: true, typ: $String, tag: ""}, {prop: "ValueElem", name: "ValueElem", embedded: false, exported: true, typ: $String, tag: ""}, {prop: "Message", name: "Message", embedded: false, exported: true, typ: $String, tag: ""}]);
	Time.init("time", [{prop: "wall", name: "wall", embedded: false, exported: false, typ: $Uint64, tag: ""}, {prop: "ext", name: "ext", embedded: false, exported: false, typ: $Int64, tag: ""}, {prop: "loc", name: "loc", embedded: false, exported: false, typ: ptrType$2, tag: ""}]);
	Location.init("time", [{prop: "name", name: "name", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "zone", name: "zone", embedded: false, exported: false, typ: sliceType, tag: ""}, {prop: "tx", name: "tx", embedded: false, exported: false, typ: sliceType$1, tag: ""}, {prop: "cacheStart", name: "cacheStart", embedded: false, exported: false, typ: $Int64, tag: ""}, {prop: "cacheEnd", name: "cacheEnd", embedded: false, exported: false, typ: $Int64, tag: ""}, {prop: "cacheZone", name: "cacheZone", embedded: false, exported: false, typ: ptrType, tag: ""}]);
	zone.init("time", [{prop: "name", name: "name", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "offset", name: "offset", embedded: false, exported: false, typ: $Int, tag: ""}, {prop: "isDST", name: "isDST", embedded: false, exported: false, typ: $Bool, tag: ""}]);
	zoneTrans.init("time", [{prop: "when", name: "when", embedded: false, exported: false, typ: $Int64, tag: ""}, {prop: "index", name: "index", embedded: false, exported: false, typ: $Uint8, tag: ""}, {prop: "isstd", name: "isstd", embedded: false, exported: false, typ: $Bool, tag: ""}, {prop: "isutc", name: "isutc", embedded: false, exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		localLoc = new Location.ptr("", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		localOnce = new nosync.Once.ptr(false, false);
		zoneSources = new sliceType$2([runtime.GOROOT() + "/lib/time/zoneinfo.zip"]);
		std0x = $toNativeArray($kindInt, [260, 265, 524, 526, 528, 274]);
		longDayNames = new sliceType$2(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		shortDayNames = new sliceType$2(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
		shortMonthNames = new sliceType$2(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
		longMonthNames = new sliceType$2(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		atoiError = errors.New("time: invalid number");
		errBad = errors.New("bad value for field");
		errLeadingInt = errors.New("time: bad [0-9]*");
		months = $toNativeArray($kindString, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		days = $toNativeArray($kindString, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		daysBefore = $toNativeArray($kindInt32, [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]);
		startNano = (x = runtimeNano(), new $Int64(x.$high - 0, x.$low - 1));
		utcLoc = new Location.ptr("UTC", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		$pkg.UTC = utcLoc;
		$pkg.Local = localLoc;
		errLocation = errors.New("time: invalid location name");
		badData = errors.New("malformed time zone information");
		$unused(new sliceType$2(["/usr/share/zoneinfo/", "/usr/share/lib/zoneinfo/", "/usr/lib/locale/TZ/", runtime.GOROOT() + "/lib/time/zoneinfo.zip"]));
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["honnef.co/go/js/dom"] = (function() {
	var $pkg = {}, $init, js, image, color, strings, time, TokenList, Document, DocumentFragment, documentFragment, document, htmlDocument, URLUtils, Location, HTMLElement, Window, window, Selection, Screen, Navigator, Geolocation, PositionError, PositionOptions, Position, Coordinates, History, Console, DocumentType, DOMImplementation, StyleSheet, Node, BasicNode, Element, ClientRect, BasicHTMLElement, BasicElement, HTMLAnchorElement, HTMLAppletElement, HTMLAreaElement, HTMLAudioElement, HTMLBRElement, HTMLBaseElement, HTMLBodyElement, HTMLButtonElement, HTMLCanvasElement, CanvasRenderingContext2D, ImageData, CanvasGradient, CanvasPattern, TextMetrics, HTMLDListElement, HTMLDataElement, HTMLDataListElement, HTMLDirectoryElement, HTMLDivElement, HTMLEmbedElement, HTMLFieldSetElement, HTMLFontElement, HTMLFormElement, HTMLFrameElement, HTMLFrameSetElement, HTMLHRElement, HTMLHeadElement, HTMLHeadingElement, HTMLHtmlElement, HTMLIFrameElement, HTMLImageElement, HTMLInputElement, File, HTMLKeygenElement, HTMLLIElement, HTMLLabelElement, HTMLLegendElement, HTMLLinkElement, HTMLMapElement, HTMLMediaElement, HTMLMenuElement, HTMLMetaElement, HTMLMeterElement, HTMLModElement, HTMLOListElement, HTMLObjectElement, HTMLOptGroupElement, HTMLOptionElement, HTMLOutputElement, HTMLParagraphElement, HTMLParamElement, HTMLPreElement, HTMLProgressElement, HTMLQuoteElement, HTMLScriptElement, HTMLSelectElement, HTMLSourceElement, HTMLSpanElement, HTMLStyleElement, HTMLTableCaptionElement, HTMLTableCellElement, HTMLTableColElement, HTMLTableDataCellElement, HTMLTableElement, HTMLTableHeaderCellElement, HTMLTableRowElement, HTMLTableSectionElement, HTMLTemplateElement, HTMLTextAreaElement, HTMLTimeElement, HTMLTitleElement, TextTrack, HTMLTrackElement, HTMLUListElement, HTMLUnknownElement, HTMLVideoElement, ValidityState, CSSStyleDeclaration, Text, Event, BasicEvent, AnimationEvent, AudioProcessingEvent, BeforeInputEvent, BeforeUnloadEvent, BlobEvent, ClipboardEvent, CloseEvent, CompositionEvent, CSSFontFaceLoadEvent, CustomEvent, DeviceLightEvent, DeviceMotionEvent, DeviceOrientationEvent, DeviceProximityEvent, DOMTransactionEvent, DragEvent, EditingBeforeInputEvent, ErrorEvent, FocusEvent, GamepadEvent, HashChangeEvent, IDBVersionChangeEvent, KeyboardEvent, MediaStreamEvent, MessageEvent, MouseEvent, MutationEvent, OfflineAudioCompletionEvent, PageTransitionEvent, PointerEvent, PopStateEvent, ProgressEvent, RelatedEvent, RTCPeerConnectionIceEvent, SensorEvent, StorageEvent, SVGEvent, SVGZoomEvent, TimeEvent, TouchEvent, Touch, TrackEvent, TransitionEvent, UIEvent, UserProximityEvent, WheelEvent, sliceType, ptrType, sliceType$1, sliceType$2, sliceType$3, sliceType$4, ptrType$1, ptrType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, sliceType$5, ptrType$7, sliceType$6, sliceType$7, sliceType$8, ptrType$8, ptrType$9, sliceType$9, ptrType$10, sliceType$10, ptrType$11, sliceType$11, ptrType$12, funcType, funcType$1, sliceType$12, ptrType$13, ptrType$14, sliceType$13, ptrType$15, ptrType$16, sliceType$14, ptrType$17, sliceType$15, ptrType$18, sliceType$16, ptrType$19, ptrType$20, ptrType$21, ptrType$22, sliceType$17, ptrType$23, funcType$2, sliceType$18, ptrType$24, ptrType$25, ptrType$26, ptrType$27, mapType, ptrType$28, ptrType$29, funcType$3, ptrType$30, ptrType$31, funcType$4, funcType$5, ptrType$32, ptrType$33, ptrType$34, ptrType$35, ptrType$36, ptrType$37, ptrType$38, ptrType$39, ptrType$40, ptrType$41, ptrType$42, ptrType$43, ptrType$44, ptrType$45, ptrType$46, ptrType$47, ptrType$48, ptrType$49, ptrType$50, ptrType$51, ptrType$52, ptrType$53, ptrType$54, ptrType$55, ptrType$56, ptrType$57, ptrType$58, ptrType$59, ptrType$60, ptrType$61, ptrType$62, toString, callRecover, elementConstructor, arrayToObjects, nodeListToObjects, nodeListToNodes, nodeListToElements, nodeListToHTMLElements, wrapDocument, wrapDocumentFragment, wrapNode, wrapElement, wrapHTMLElement, getForm, getLabels, getOptions, GetWindow, wrapDOMHighResTimeStamp, wrapEvent, touchListToTouches;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	image = $packages["image"];
	color = $packages["image/color"];
	strings = $packages["strings"];
	time = $packages["time"];
	TokenList = $pkg.TokenList = $newType(0, $kindStruct, "dom.TokenList", true, "honnef.co/go/js/dom", true, function(dtl_, o_, sa_, Length_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.dtl = null;
			this.o = null;
			this.sa = "";
			this.Length = 0;
			return;
		}
		this.dtl = dtl_;
		this.o = o_;
		this.sa = sa_;
		this.Length = Length_;
	});
	Document = $pkg.Document = $newType(8, $kindInterface, "dom.Document", true, "honnef.co/go/js/dom", true, null);
	DocumentFragment = $pkg.DocumentFragment = $newType(8, $kindInterface, "dom.DocumentFragment", true, "honnef.co/go/js/dom", true, null);
	documentFragment = $pkg.documentFragment = $newType(0, $kindStruct, "dom.documentFragment", true, "honnef.co/go/js/dom", false, function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$25.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	document = $pkg.document = $newType(0, $kindStruct, "dom.document", true, "honnef.co/go/js/dom", false, function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$25.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	htmlDocument = $pkg.htmlDocument = $newType(0, $kindStruct, "dom.htmlDocument", true, "honnef.co/go/js/dom", false, function(document_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.document = ptrType$26.nil;
			return;
		}
		this.document = document_;
	});
	URLUtils = $pkg.URLUtils = $newType(0, $kindStruct, "dom.URLUtils", true, "honnef.co/go/js/dom", true, function(Object_, Href_, Protocol_, Host_, Hostname_, Port_, Pathname_, Search_, Hash_, Username_, Password_, Origin_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Href = "";
			this.Protocol = "";
			this.Host = "";
			this.Hostname = "";
			this.Port = "";
			this.Pathname = "";
			this.Search = "";
			this.Hash = "";
			this.Username = "";
			this.Password = "";
			this.Origin = "";
			return;
		}
		this.Object = Object_;
		this.Href = Href_;
		this.Protocol = Protocol_;
		this.Host = Host_;
		this.Hostname = Hostname_;
		this.Port = Port_;
		this.Pathname = Pathname_;
		this.Search = Search_;
		this.Hash = Hash_;
		this.Username = Username_;
		this.Password = Password_;
		this.Origin = Origin_;
	});
	Location = $pkg.Location = $newType(0, $kindStruct, "dom.Location", true, "honnef.co/go/js/dom", true, function(Object_, URLUtils_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.URLUtils = ptrType$2.nil;
			return;
		}
		this.Object = Object_;
		this.URLUtils = URLUtils_;
	});
	HTMLElement = $pkg.HTMLElement = $newType(8, $kindInterface, "dom.HTMLElement", true, "honnef.co/go/js/dom", true, null);
	Window = $pkg.Window = $newType(8, $kindInterface, "dom.Window", true, "honnef.co/go/js/dom", true, null);
	window = $pkg.window = $newType(0, $kindStruct, "dom.window", true, "honnef.co/go/js/dom", false, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Selection = $pkg.Selection = $newType(8, $kindInterface, "dom.Selection", true, "honnef.co/go/js/dom", true, null);
	Screen = $pkg.Screen = $newType(0, $kindStruct, "dom.Screen", true, "honnef.co/go/js/dom", true, function(Object_, AvailTop_, AvailLeft_, AvailHeight_, AvailWidth_, ColorDepth_, Height_, Left_, PixelDepth_, Top_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.AvailTop = 0;
			this.AvailLeft = 0;
			this.AvailHeight = 0;
			this.AvailWidth = 0;
			this.ColorDepth = 0;
			this.Height = 0;
			this.Left = 0;
			this.PixelDepth = 0;
			this.Top = 0;
			this.Width = 0;
			return;
		}
		this.Object = Object_;
		this.AvailTop = AvailTop_;
		this.AvailLeft = AvailLeft_;
		this.AvailHeight = AvailHeight_;
		this.AvailWidth = AvailWidth_;
		this.ColorDepth = ColorDepth_;
		this.Height = Height_;
		this.Left = Left_;
		this.PixelDepth = PixelDepth_;
		this.Top = Top_;
		this.Width = Width_;
	});
	Navigator = $pkg.Navigator = $newType(8, $kindInterface, "dom.Navigator", true, "honnef.co/go/js/dom", true, null);
	Geolocation = $pkg.Geolocation = $newType(8, $kindInterface, "dom.Geolocation", true, "honnef.co/go/js/dom", true, null);
	PositionError = $pkg.PositionError = $newType(0, $kindStruct, "dom.PositionError", true, "honnef.co/go/js/dom", true, function(Object_, Code_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Code = 0;
			return;
		}
		this.Object = Object_;
		this.Code = Code_;
	});
	PositionOptions = $pkg.PositionOptions = $newType(0, $kindStruct, "dom.PositionOptions", true, "honnef.co/go/js/dom", true, function(EnableHighAccuracy_, Timeout_, MaximumAge_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EnableHighAccuracy = false;
			this.Timeout = new time.Duration(0, 0);
			this.MaximumAge = new time.Duration(0, 0);
			return;
		}
		this.EnableHighAccuracy = EnableHighAccuracy_;
		this.Timeout = Timeout_;
		this.MaximumAge = MaximumAge_;
	});
	Position = $pkg.Position = $newType(0, $kindStruct, "dom.Position", true, "honnef.co/go/js/dom", true, function(Coords_, Timestamp_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Coords = ptrType$33.nil;
			this.Timestamp = new time.Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$4.nil);
			return;
		}
		this.Coords = Coords_;
		this.Timestamp = Timestamp_;
	});
	Coordinates = $pkg.Coordinates = $newType(0, $kindStruct, "dom.Coordinates", true, "honnef.co/go/js/dom", true, function(Object_, Latitude_, Longitude_, Altitude_, Accuracy_, AltitudeAccuracy_, Heading_, Speed_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Latitude = 0;
			this.Longitude = 0;
			this.Altitude = 0;
			this.Accuracy = 0;
			this.AltitudeAccuracy = 0;
			this.Heading = 0;
			this.Speed = 0;
			return;
		}
		this.Object = Object_;
		this.Latitude = Latitude_;
		this.Longitude = Longitude_;
		this.Altitude = Altitude_;
		this.Accuracy = Accuracy_;
		this.AltitudeAccuracy = AltitudeAccuracy_;
		this.Heading = Heading_;
		this.Speed = Speed_;
	});
	History = $pkg.History = $newType(8, $kindInterface, "dom.History", true, "honnef.co/go/js/dom", true, null);
	Console = $pkg.Console = $newType(0, $kindStruct, "dom.Console", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	DocumentType = $pkg.DocumentType = $newType(8, $kindInterface, "dom.DocumentType", true, "honnef.co/go/js/dom", true, null);
	DOMImplementation = $pkg.DOMImplementation = $newType(8, $kindInterface, "dom.DOMImplementation", true, "honnef.co/go/js/dom", true, null);
	StyleSheet = $pkg.StyleSheet = $newType(8, $kindInterface, "dom.StyleSheet", true, "honnef.co/go/js/dom", true, null);
	Node = $pkg.Node = $newType(8, $kindInterface, "dom.Node", true, "honnef.co/go/js/dom", true, null);
	BasicNode = $pkg.BasicNode = $newType(0, $kindStruct, "dom.BasicNode", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Element = $pkg.Element = $newType(8, $kindInterface, "dom.Element", true, "honnef.co/go/js/dom", true, null);
	ClientRect = $pkg.ClientRect = $newType(0, $kindStruct, "dom.ClientRect", true, "honnef.co/go/js/dom", true, function(Object_, Height_, Width_, Left_, Right_, Top_, Bottom_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Height = 0;
			this.Width = 0;
			this.Left = 0;
			this.Right = 0;
			this.Top = 0;
			this.Bottom = 0;
			return;
		}
		this.Object = Object_;
		this.Height = Height_;
		this.Width = Width_;
		this.Left = Left_;
		this.Right = Right_;
		this.Top = Top_;
		this.Bottom = Bottom_;
	});
	BasicHTMLElement = $pkg.BasicHTMLElement = $newType(0, $kindStruct, "dom.BasicHTMLElement", true, "honnef.co/go/js/dom", true, function(BasicElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicElement = ptrType$34.nil;
			return;
		}
		this.BasicElement = BasicElement_;
	});
	BasicElement = $pkg.BasicElement = $newType(0, $kindStruct, "dom.BasicElement", true, "honnef.co/go/js/dom", true, function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$25.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	HTMLAnchorElement = $pkg.HTMLAnchorElement = $newType(0, $kindStruct, "dom.HTMLAnchorElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, URLUtils_, HrefLang_, Media_, TabIndex_, Target_, Text_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.URLUtils = ptrType$2.nil;
			this.HrefLang = "";
			this.Media = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Text = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.URLUtils = URLUtils_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Text = Text_;
		this.Type = Type_;
	});
	HTMLAppletElement = $pkg.HTMLAppletElement = $newType(0, $kindStruct, "dom.HTMLAppletElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Alt_, Coords_, HrefLang_, Media_, Search_, Shape_, TabIndex_, Target_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Alt = "";
			this.Coords = "";
			this.HrefLang = "";
			this.Media = "";
			this.Search = "";
			this.Shape = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Alt = Alt_;
		this.Coords = Coords_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Search = Search_;
		this.Shape = Shape_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Type = Type_;
	});
	HTMLAreaElement = $pkg.HTMLAreaElement = $newType(0, $kindStruct, "dom.HTMLAreaElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, URLUtils_, Alt_, Coords_, HrefLang_, Media_, Search_, Shape_, TabIndex_, Target_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.URLUtils = ptrType$2.nil;
			this.Alt = "";
			this.Coords = "";
			this.HrefLang = "";
			this.Media = "";
			this.Search = "";
			this.Shape = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.URLUtils = URLUtils_;
		this.Alt = Alt_;
		this.Coords = Coords_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Search = Search_;
		this.Shape = Shape_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Type = Type_;
	});
	HTMLAudioElement = $pkg.HTMLAudioElement = $newType(0, $kindStruct, "dom.HTMLAudioElement", true, "honnef.co/go/js/dom", true, function(HTMLMediaElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.HTMLMediaElement = ptrType$3.nil;
			return;
		}
		this.HTMLMediaElement = HTMLMediaElement_;
	});
	HTMLBRElement = $pkg.HTMLBRElement = $newType(0, $kindStruct, "dom.HTMLBRElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLBaseElement = $pkg.HTMLBaseElement = $newType(0, $kindStruct, "dom.HTMLBaseElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLBodyElement = $pkg.HTMLBodyElement = $newType(0, $kindStruct, "dom.HTMLBodyElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLButtonElement = $pkg.HTMLButtonElement = $newType(0, $kindStruct, "dom.HTMLButtonElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, AutoFocus_, Disabled_, FormAction_, FormEncType_, FormMethod_, FormNoValidate_, FormTarget_, Name_, TabIndex_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.AutoFocus = false;
			this.Disabled = false;
			this.FormAction = "";
			this.FormEncType = "";
			this.FormMethod = "";
			this.FormNoValidate = false;
			this.FormTarget = "";
			this.Name = "";
			this.TabIndex = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.AutoFocus = AutoFocus_;
		this.Disabled = Disabled_;
		this.FormAction = FormAction_;
		this.FormEncType = FormEncType_;
		this.FormMethod = FormMethod_;
		this.FormNoValidate = FormNoValidate_;
		this.FormTarget = FormTarget_;
		this.Name = Name_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLCanvasElement = $pkg.HTMLCanvasElement = $newType(0, $kindStruct, "dom.HTMLCanvasElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Height_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Height = 0;
			this.Width = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Height = Height_;
		this.Width = Width_;
	});
	CanvasRenderingContext2D = $pkg.CanvasRenderingContext2D = $newType(0, $kindStruct, "dom.CanvasRenderingContext2D", true, "honnef.co/go/js/dom", true, function(Object_, FillStyle_, StrokeStyle_, ShadowColor_, ShadowBlur_, ShadowOffsetX_, ShadowOffsetY_, LineCap_, LineJoin_, LineWidth_, MiterLimit_, Font_, TextAlign_, TextBaseline_, GlobalAlpha_, GlobalCompositeOperation_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.FillStyle = "";
			this.StrokeStyle = "";
			this.ShadowColor = "";
			this.ShadowBlur = 0;
			this.ShadowOffsetX = 0;
			this.ShadowOffsetY = 0;
			this.LineCap = "";
			this.LineJoin = "";
			this.LineWidth = 0;
			this.MiterLimit = 0;
			this.Font = "";
			this.TextAlign = "";
			this.TextBaseline = "";
			this.GlobalAlpha = 0;
			this.GlobalCompositeOperation = "";
			return;
		}
		this.Object = Object_;
		this.FillStyle = FillStyle_;
		this.StrokeStyle = StrokeStyle_;
		this.ShadowColor = ShadowColor_;
		this.ShadowBlur = ShadowBlur_;
		this.ShadowOffsetX = ShadowOffsetX_;
		this.ShadowOffsetY = ShadowOffsetY_;
		this.LineCap = LineCap_;
		this.LineJoin = LineJoin_;
		this.LineWidth = LineWidth_;
		this.MiterLimit = MiterLimit_;
		this.Font = Font_;
		this.TextAlign = TextAlign_;
		this.TextBaseline = TextBaseline_;
		this.GlobalAlpha = GlobalAlpha_;
		this.GlobalCompositeOperation = GlobalCompositeOperation_;
	});
	ImageData = $pkg.ImageData = $newType(0, $kindStruct, "dom.ImageData", true, "honnef.co/go/js/dom", true, function(Object_, Width_, Height_, Data_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Width = 0;
			this.Height = 0;
			this.Data = null;
			return;
		}
		this.Object = Object_;
		this.Width = Width_;
		this.Height = Height_;
		this.Data = Data_;
	});
	CanvasGradient = $pkg.CanvasGradient = $newType(0, $kindStruct, "dom.CanvasGradient", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	CanvasPattern = $pkg.CanvasPattern = $newType(0, $kindStruct, "dom.CanvasPattern", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	TextMetrics = $pkg.TextMetrics = $newType(0, $kindStruct, "dom.TextMetrics", true, "honnef.co/go/js/dom", true, function(Object_, Width_, ActualBoundingBoxLeft_, ActualBoundingBoxRight_, FontBoundingBoxAscent_, FontBoundingBoxDescent_, ActualBoundingBoxAscent_, ActualBoundingBoxDescent_, EmHeightAscent_, EmHeightDescent_, HangingBaseline_, AlphabeticBaseline_, IdeographicBaseline_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Width = 0;
			this.ActualBoundingBoxLeft = 0;
			this.ActualBoundingBoxRight = 0;
			this.FontBoundingBoxAscent = 0;
			this.FontBoundingBoxDescent = 0;
			this.ActualBoundingBoxAscent = 0;
			this.ActualBoundingBoxDescent = 0;
			this.EmHeightAscent = 0;
			this.EmHeightDescent = 0;
			this.HangingBaseline = 0;
			this.AlphabeticBaseline = 0;
			this.IdeographicBaseline = 0;
			return;
		}
		this.Object = Object_;
		this.Width = Width_;
		this.ActualBoundingBoxLeft = ActualBoundingBoxLeft_;
		this.ActualBoundingBoxRight = ActualBoundingBoxRight_;
		this.FontBoundingBoxAscent = FontBoundingBoxAscent_;
		this.FontBoundingBoxDescent = FontBoundingBoxDescent_;
		this.ActualBoundingBoxAscent = ActualBoundingBoxAscent_;
		this.ActualBoundingBoxDescent = ActualBoundingBoxDescent_;
		this.EmHeightAscent = EmHeightAscent_;
		this.EmHeightDescent = EmHeightDescent_;
		this.HangingBaseline = HangingBaseline_;
		this.AlphabeticBaseline = AlphabeticBaseline_;
		this.IdeographicBaseline = IdeographicBaseline_;
	});
	HTMLDListElement = $pkg.HTMLDListElement = $newType(0, $kindStruct, "dom.HTMLDListElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDataElement = $pkg.HTMLDataElement = $newType(0, $kindStruct, "dom.HTMLDataElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Value = Value_;
	});
	HTMLDataListElement = $pkg.HTMLDataListElement = $newType(0, $kindStruct, "dom.HTMLDataListElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDirectoryElement = $pkg.HTMLDirectoryElement = $newType(0, $kindStruct, "dom.HTMLDirectoryElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDivElement = $pkg.HTMLDivElement = $newType(0, $kindStruct, "dom.HTMLDivElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLEmbedElement = $pkg.HTMLEmbedElement = $newType(0, $kindStruct, "dom.HTMLEmbedElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Src_, Type_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Src = "";
			this.Type = "";
			this.Width = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Src = Src_;
		this.Type = Type_;
		this.Width = Width_;
	});
	HTMLFieldSetElement = $pkg.HTMLFieldSetElement = $newType(0, $kindStruct, "dom.HTMLFieldSetElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Disabled_, Name_, Type_, ValidationMessage_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.WillValidate = WillValidate_;
	});
	HTMLFontElement = $pkg.HTMLFontElement = $newType(0, $kindStruct, "dom.HTMLFontElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLFormElement = $pkg.HTMLFormElement = $newType(0, $kindStruct, "dom.HTMLFormElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, AcceptCharset_, Action_, Autocomplete_, Encoding_, Enctype_, Length_, Method_, Name_, NoValidate_, Target_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.AcceptCharset = "";
			this.Action = "";
			this.Autocomplete = "";
			this.Encoding = "";
			this.Enctype = "";
			this.Length = 0;
			this.Method = "";
			this.Name = "";
			this.NoValidate = false;
			this.Target = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.AcceptCharset = AcceptCharset_;
		this.Action = Action_;
		this.Autocomplete = Autocomplete_;
		this.Encoding = Encoding_;
		this.Enctype = Enctype_;
		this.Length = Length_;
		this.Method = Method_;
		this.Name = Name_;
		this.NoValidate = NoValidate_;
		this.Target = Target_;
	});
	HTMLFrameElement = $pkg.HTMLFrameElement = $newType(0, $kindStruct, "dom.HTMLFrameElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLFrameSetElement = $pkg.HTMLFrameSetElement = $newType(0, $kindStruct, "dom.HTMLFrameSetElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHRElement = $pkg.HTMLHRElement = $newType(0, $kindStruct, "dom.HTMLHRElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHeadElement = $pkg.HTMLHeadElement = $newType(0, $kindStruct, "dom.HTMLHeadElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHeadingElement = $pkg.HTMLHeadingElement = $newType(0, $kindStruct, "dom.HTMLHeadingElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHtmlElement = $pkg.HTMLHtmlElement = $newType(0, $kindStruct, "dom.HTMLHtmlElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLIFrameElement = $pkg.HTMLIFrameElement = $newType(0, $kindStruct, "dom.HTMLIFrameElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Width_, Height_, Name_, Src_, SrcDoc_, Seamless_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Width = "";
			this.Height = "";
			this.Name = "";
			this.Src = "";
			this.SrcDoc = "";
			this.Seamless = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Width = Width_;
		this.Height = Height_;
		this.Name = Name_;
		this.Src = Src_;
		this.SrcDoc = SrcDoc_;
		this.Seamless = Seamless_;
	});
	HTMLImageElement = $pkg.HTMLImageElement = $newType(0, $kindStruct, "dom.HTMLImageElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Complete_, CrossOrigin_, Height_, IsMap_, NaturalHeight_, NaturalWidth_, Src_, UseMap_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Complete = false;
			this.CrossOrigin = "";
			this.Height = 0;
			this.IsMap = false;
			this.NaturalHeight = 0;
			this.NaturalWidth = 0;
			this.Src = "";
			this.UseMap = "";
			this.Width = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Complete = Complete_;
		this.CrossOrigin = CrossOrigin_;
		this.Height = Height_;
		this.IsMap = IsMap_;
		this.NaturalHeight = NaturalHeight_;
		this.NaturalWidth = NaturalWidth_;
		this.Src = Src_;
		this.UseMap = UseMap_;
		this.Width = Width_;
	});
	HTMLInputElement = $pkg.HTMLInputElement = $newType(0, $kindStruct, "dom.HTMLInputElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Accept_, Alt_, Autocomplete_, Autofocus_, Checked_, DefaultChecked_, DefaultValue_, DirName_, Disabled_, FormAction_, FormEncType_, FormMethod_, FormNoValidate_, FormTarget_, Height_, Indeterminate_, Max_, MaxLength_, Min_, Multiple_, Name_, Pattern_, Placeholder_, ReadOnly_, Required_, SelectionDirection_, SelectionEnd_, SelectionStart_, Size_, Src_, Step_, TabIndex_, Type_, ValidationMessage_, Value_, ValueAsDate_, ValueAsNumber_, Width_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Accept = "";
			this.Alt = "";
			this.Autocomplete = "";
			this.Autofocus = false;
			this.Checked = false;
			this.DefaultChecked = false;
			this.DefaultValue = "";
			this.DirName = "";
			this.Disabled = false;
			this.FormAction = "";
			this.FormEncType = "";
			this.FormMethod = "";
			this.FormNoValidate = false;
			this.FormTarget = "";
			this.Height = "";
			this.Indeterminate = false;
			this.Max = "";
			this.MaxLength = 0;
			this.Min = "";
			this.Multiple = false;
			this.Name = "";
			this.Pattern = "";
			this.Placeholder = "";
			this.ReadOnly = false;
			this.Required = false;
			this.SelectionDirection = "";
			this.SelectionEnd = 0;
			this.SelectionStart = 0;
			this.Size = 0;
			this.Src = "";
			this.Step = "";
			this.TabIndex = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.ValueAsDate = new time.Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$4.nil);
			this.ValueAsNumber = 0;
			this.Width = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Accept = Accept_;
		this.Alt = Alt_;
		this.Autocomplete = Autocomplete_;
		this.Autofocus = Autofocus_;
		this.Checked = Checked_;
		this.DefaultChecked = DefaultChecked_;
		this.DefaultValue = DefaultValue_;
		this.DirName = DirName_;
		this.Disabled = Disabled_;
		this.FormAction = FormAction_;
		this.FormEncType = FormEncType_;
		this.FormMethod = FormMethod_;
		this.FormNoValidate = FormNoValidate_;
		this.FormTarget = FormTarget_;
		this.Height = Height_;
		this.Indeterminate = Indeterminate_;
		this.Max = Max_;
		this.MaxLength = MaxLength_;
		this.Min = Min_;
		this.Multiple = Multiple_;
		this.Name = Name_;
		this.Pattern = Pattern_;
		this.Placeholder = Placeholder_;
		this.ReadOnly = ReadOnly_;
		this.Required = Required_;
		this.SelectionDirection = SelectionDirection_;
		this.SelectionEnd = SelectionEnd_;
		this.SelectionStart = SelectionStart_;
		this.Size = Size_;
		this.Src = Src_;
		this.Step = Step_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.ValueAsDate = ValueAsDate_;
		this.ValueAsNumber = ValueAsNumber_;
		this.Width = Width_;
		this.WillValidate = WillValidate_;
	});
	File = $pkg.File = $newType(0, $kindStruct, "dom.File", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	HTMLKeygenElement = $pkg.HTMLKeygenElement = $newType(0, $kindStruct, "dom.HTMLKeygenElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Autofocus_, Challenge_, Disabled_, Keytype_, Name_, Type_, ValidationMessage_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autofocus = false;
			this.Challenge = "";
			this.Disabled = false;
			this.Keytype = "";
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autofocus = Autofocus_;
		this.Challenge = Challenge_;
		this.Disabled = Disabled_;
		this.Keytype = Keytype_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.WillValidate = WillValidate_;
	});
	HTMLLIElement = $pkg.HTMLLIElement = $newType(0, $kindStruct, "dom.HTMLLIElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Value = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Value = Value_;
	});
	HTMLLabelElement = $pkg.HTMLLabelElement = $newType(0, $kindStruct, "dom.HTMLLabelElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, For_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.For = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.For = For_;
	});
	HTMLLegendElement = $pkg.HTMLLegendElement = $newType(0, $kindStruct, "dom.HTMLLegendElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLLinkElement = $pkg.HTMLLinkElement = $newType(0, $kindStruct, "dom.HTMLLinkElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Disabled_, Href_, HrefLang_, Media_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Href = "";
			this.HrefLang = "";
			this.Media = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Href = Href_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Type = Type_;
	});
	HTMLMapElement = $pkg.HTMLMapElement = $newType(0, $kindStruct, "dom.HTMLMapElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Name = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Name = Name_;
	});
	HTMLMediaElement = $pkg.HTMLMediaElement = $newType(0, $kindStruct, "dom.HTMLMediaElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Paused_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Paused = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Paused = Paused_;
	});
	HTMLMenuElement = $pkg.HTMLMenuElement = $newType(0, $kindStruct, "dom.HTMLMenuElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLMetaElement = $pkg.HTMLMetaElement = $newType(0, $kindStruct, "dom.HTMLMetaElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Content_, HTTPEquiv_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Content = "";
			this.HTTPEquiv = "";
			this.Name = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Content = Content_;
		this.HTTPEquiv = HTTPEquiv_;
		this.Name = Name_;
	});
	HTMLMeterElement = $pkg.HTMLMeterElement = $newType(0, $kindStruct, "dom.HTMLMeterElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, High_, Low_, Max_, Min_, Optimum_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.High = 0;
			this.Low = 0;
			this.Max = 0;
			this.Min = 0;
			this.Optimum = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.High = High_;
		this.Low = Low_;
		this.Max = Max_;
		this.Min = Min_;
		this.Optimum = Optimum_;
	});
	HTMLModElement = $pkg.HTMLModElement = $newType(0, $kindStruct, "dom.HTMLModElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Cite_, DateTime_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Cite = "";
			this.DateTime = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Cite = Cite_;
		this.DateTime = DateTime_;
	});
	HTMLOListElement = $pkg.HTMLOListElement = $newType(0, $kindStruct, "dom.HTMLOListElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Reversed_, Start_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Reversed = false;
			this.Start = 0;
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Reversed = Reversed_;
		this.Start = Start_;
		this.Type = Type_;
	});
	HTMLObjectElement = $pkg.HTMLObjectElement = $newType(0, $kindStruct, "dom.HTMLObjectElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Data_, Height_, Name_, TabIndex_, Type_, TypeMustMatch_, UseMap_, ValidationMessage_, With_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Data = "";
			this.Height = "";
			this.Name = "";
			this.TabIndex = 0;
			this.Type = "";
			this.TypeMustMatch = false;
			this.UseMap = "";
			this.ValidationMessage = "";
			this.With = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Data = Data_;
		this.Height = Height_;
		this.Name = Name_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.TypeMustMatch = TypeMustMatch_;
		this.UseMap = UseMap_;
		this.ValidationMessage = ValidationMessage_;
		this.With = With_;
		this.WillValidate = WillValidate_;
	});
	HTMLOptGroupElement = $pkg.HTMLOptGroupElement = $newType(0, $kindStruct, "dom.HTMLOptGroupElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Disabled_, Label_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Label = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Label = Label_;
	});
	HTMLOptionElement = $pkg.HTMLOptionElement = $newType(0, $kindStruct, "dom.HTMLOptionElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, DefaultSelected_, Disabled_, Index_, Label_, Selected_, Text_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DefaultSelected = false;
			this.Disabled = false;
			this.Index = 0;
			this.Label = "";
			this.Selected = false;
			this.Text = "";
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DefaultSelected = DefaultSelected_;
		this.Disabled = Disabled_;
		this.Index = Index_;
		this.Label = Label_;
		this.Selected = Selected_;
		this.Text = Text_;
		this.Value = Value_;
	});
	HTMLOutputElement = $pkg.HTMLOutputElement = $newType(0, $kindStruct, "dom.HTMLOutputElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, DefaultValue_, Name_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DefaultValue = "";
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DefaultValue = DefaultValue_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLParagraphElement = $pkg.HTMLParagraphElement = $newType(0, $kindStruct, "dom.HTMLParagraphElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLParamElement = $pkg.HTMLParamElement = $newType(0, $kindStruct, "dom.HTMLParamElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Name_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Name = "";
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Name = Name_;
		this.Value = Value_;
	});
	HTMLPreElement = $pkg.HTMLPreElement = $newType(0, $kindStruct, "dom.HTMLPreElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLProgressElement = $pkg.HTMLProgressElement = $newType(0, $kindStruct, "dom.HTMLProgressElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Max_, Position_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Max = 0;
			this.Position = 0;
			this.Value = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Max = Max_;
		this.Position = Position_;
		this.Value = Value_;
	});
	HTMLQuoteElement = $pkg.HTMLQuoteElement = $newType(0, $kindStruct, "dom.HTMLQuoteElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Cite_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Cite = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Cite = Cite_;
	});
	HTMLScriptElement = $pkg.HTMLScriptElement = $newType(0, $kindStruct, "dom.HTMLScriptElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Type_, Src_, Charset_, Async_, Defer_, Text_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Type = "";
			this.Src = "";
			this.Charset = "";
			this.Async = false;
			this.Defer = false;
			this.Text = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Type = Type_;
		this.Src = Src_;
		this.Charset = Charset_;
		this.Async = Async_;
		this.Defer = Defer_;
		this.Text = Text_;
	});
	HTMLSelectElement = $pkg.HTMLSelectElement = $newType(0, $kindStruct, "dom.HTMLSelectElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Autofocus_, Disabled_, Length_, Multiple_, Name_, Required_, SelectedIndex_, Size_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autofocus = false;
			this.Disabled = false;
			this.Length = 0;
			this.Multiple = false;
			this.Name = "";
			this.Required = false;
			this.SelectedIndex = 0;
			this.Size = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autofocus = Autofocus_;
		this.Disabled = Disabled_;
		this.Length = Length_;
		this.Multiple = Multiple_;
		this.Name = Name_;
		this.Required = Required_;
		this.SelectedIndex = SelectedIndex_;
		this.Size = Size_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLSourceElement = $pkg.HTMLSourceElement = $newType(0, $kindStruct, "dom.HTMLSourceElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Media_, Src_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Media = "";
			this.Src = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Media = Media_;
		this.Src = Src_;
		this.Type = Type_;
	});
	HTMLSpanElement = $pkg.HTMLSpanElement = $newType(0, $kindStruct, "dom.HTMLSpanElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLStyleElement = $pkg.HTMLStyleElement = $newType(0, $kindStruct, "dom.HTMLStyleElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableCaptionElement = $pkg.HTMLTableCaptionElement = $newType(0, $kindStruct, "dom.HTMLTableCaptionElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableCellElement = $pkg.HTMLTableCellElement = $newType(0, $kindStruct, "dom.HTMLTableCellElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, ColSpan_, RowSpan_, CellIndex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.ColSpan = 0;
			this.RowSpan = 0;
			this.CellIndex = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.ColSpan = ColSpan_;
		this.RowSpan = RowSpan_;
		this.CellIndex = CellIndex_;
	});
	HTMLTableColElement = $pkg.HTMLTableColElement = $newType(0, $kindStruct, "dom.HTMLTableColElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Span_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Span = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Span = Span_;
	});
	HTMLTableDataCellElement = $pkg.HTMLTableDataCellElement = $newType(0, $kindStruct, "dom.HTMLTableDataCellElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableElement = $pkg.HTMLTableElement = $newType(0, $kindStruct, "dom.HTMLTableElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableHeaderCellElement = $pkg.HTMLTableHeaderCellElement = $newType(0, $kindStruct, "dom.HTMLTableHeaderCellElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Abbr_, Scope_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Abbr = "";
			this.Scope = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Abbr = Abbr_;
		this.Scope = Scope_;
	});
	HTMLTableRowElement = $pkg.HTMLTableRowElement = $newType(0, $kindStruct, "dom.HTMLTableRowElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, RowIndex_, SectionRowIndex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.RowIndex = 0;
			this.SectionRowIndex = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.RowIndex = RowIndex_;
		this.SectionRowIndex = SectionRowIndex_;
	});
	HTMLTableSectionElement = $pkg.HTMLTableSectionElement = $newType(0, $kindStruct, "dom.HTMLTableSectionElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTemplateElement = $pkg.HTMLTemplateElement = $newType(0, $kindStruct, "dom.HTMLTemplateElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTextAreaElement = $pkg.HTMLTextAreaElement = $newType(0, $kindStruct, "dom.HTMLTextAreaElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Autocomplete_, Autofocus_, Cols_, DefaultValue_, DirName_, Disabled_, MaxLength_, Name_, Placeholder_, ReadOnly_, Required_, Rows_, SelectionDirection_, SelectionStart_, SelectionEnd_, TabIndex_, TextLength_, Type_, ValidationMessage_, Value_, WillValidate_, Wrap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autocomplete = "";
			this.Autofocus = false;
			this.Cols = 0;
			this.DefaultValue = "";
			this.DirName = "";
			this.Disabled = false;
			this.MaxLength = 0;
			this.Name = "";
			this.Placeholder = "";
			this.ReadOnly = false;
			this.Required = false;
			this.Rows = 0;
			this.SelectionDirection = "";
			this.SelectionStart = 0;
			this.SelectionEnd = 0;
			this.TabIndex = 0;
			this.TextLength = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			this.Wrap = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autocomplete = Autocomplete_;
		this.Autofocus = Autofocus_;
		this.Cols = Cols_;
		this.DefaultValue = DefaultValue_;
		this.DirName = DirName_;
		this.Disabled = Disabled_;
		this.MaxLength = MaxLength_;
		this.Name = Name_;
		this.Placeholder = Placeholder_;
		this.ReadOnly = ReadOnly_;
		this.Required = Required_;
		this.Rows = Rows_;
		this.SelectionDirection = SelectionDirection_;
		this.SelectionStart = SelectionStart_;
		this.SelectionEnd = SelectionEnd_;
		this.TabIndex = TabIndex_;
		this.TextLength = TextLength_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
		this.Wrap = Wrap_;
	});
	HTMLTimeElement = $pkg.HTMLTimeElement = $newType(0, $kindStruct, "dom.HTMLTimeElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, DateTime_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DateTime = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DateTime = DateTime_;
	});
	HTMLTitleElement = $pkg.HTMLTitleElement = $newType(0, $kindStruct, "dom.HTMLTitleElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Text_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Text = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Text = Text_;
	});
	TextTrack = $pkg.TextTrack = $newType(0, $kindStruct, "dom.TextTrack", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	HTMLTrackElement = $pkg.HTMLTrackElement = $newType(0, $kindStruct, "dom.HTMLTrackElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_, Kind_, Src_, Srclang_, Label_, Default_, ReadyState_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Kind = "";
			this.Src = "";
			this.Srclang = "";
			this.Label = "";
			this.Default = false;
			this.ReadyState = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Kind = Kind_;
		this.Src = Src_;
		this.Srclang = Srclang_;
		this.Label = Label_;
		this.Default = Default_;
		this.ReadyState = ReadyState_;
	});
	HTMLUListElement = $pkg.HTMLUListElement = $newType(0, $kindStruct, "dom.HTMLUListElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLUnknownElement = $pkg.HTMLUnknownElement = $newType(0, $kindStruct, "dom.HTMLUnknownElement", true, "honnef.co/go/js/dom", true, function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLVideoElement = $pkg.HTMLVideoElement = $newType(0, $kindStruct, "dom.HTMLVideoElement", true, "honnef.co/go/js/dom", true, function(HTMLMediaElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.HTMLMediaElement = ptrType$3.nil;
			return;
		}
		this.HTMLMediaElement = HTMLMediaElement_;
	});
	ValidityState = $pkg.ValidityState = $newType(0, $kindStruct, "dom.ValidityState", true, "honnef.co/go/js/dom", true, function(Object_, CustomError_, PatternMismatch_, RangeOverflow_, RangeUnderflow_, StepMismatch_, TooLong_, TypeMismatch_, Valid_, ValueMissing_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.CustomError = false;
			this.PatternMismatch = false;
			this.RangeOverflow = false;
			this.RangeUnderflow = false;
			this.StepMismatch = false;
			this.TooLong = false;
			this.TypeMismatch = false;
			this.Valid = false;
			this.ValueMissing = false;
			return;
		}
		this.Object = Object_;
		this.CustomError = CustomError_;
		this.PatternMismatch = PatternMismatch_;
		this.RangeOverflow = RangeOverflow_;
		this.RangeUnderflow = RangeUnderflow_;
		this.StepMismatch = StepMismatch_;
		this.TooLong = TooLong_;
		this.TypeMismatch = TypeMismatch_;
		this.Valid = Valid_;
		this.ValueMissing = ValueMissing_;
	});
	CSSStyleDeclaration = $pkg.CSSStyleDeclaration = $newType(0, $kindStruct, "dom.CSSStyleDeclaration", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Text = $pkg.Text = $newType(0, $kindStruct, "dom.Text", true, "honnef.co/go/js/dom", true, function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$25.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	Event = $pkg.Event = $newType(8, $kindInterface, "dom.Event", true, "honnef.co/go/js/dom", true, null);
	BasicEvent = $pkg.BasicEvent = $newType(0, $kindStruct, "dom.BasicEvent", true, "honnef.co/go/js/dom", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	AnimationEvent = $pkg.AnimationEvent = $newType(0, $kindStruct, "dom.AnimationEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	AudioProcessingEvent = $pkg.AudioProcessingEvent = $newType(0, $kindStruct, "dom.AudioProcessingEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BeforeInputEvent = $pkg.BeforeInputEvent = $newType(0, $kindStruct, "dom.BeforeInputEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BeforeUnloadEvent = $pkg.BeforeUnloadEvent = $newType(0, $kindStruct, "dom.BeforeUnloadEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BlobEvent = $pkg.BlobEvent = $newType(0, $kindStruct, "dom.BlobEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ClipboardEvent = $pkg.ClipboardEvent = $newType(0, $kindStruct, "dom.ClipboardEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CloseEvent = $pkg.CloseEvent = $newType(0, $kindStruct, "dom.CloseEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_, Code_, Reason_, WasClean_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			this.Code = 0;
			this.Reason = "";
			this.WasClean = false;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.Code = Code_;
		this.Reason = Reason_;
		this.WasClean = WasClean_;
	});
	CompositionEvent = $pkg.CompositionEvent = $newType(0, $kindStruct, "dom.CompositionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CSSFontFaceLoadEvent = $pkg.CSSFontFaceLoadEvent = $newType(0, $kindStruct, "dom.CSSFontFaceLoadEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CustomEvent = $pkg.CustomEvent = $newType(0, $kindStruct, "dom.CustomEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceLightEvent = $pkg.DeviceLightEvent = $newType(0, $kindStruct, "dom.DeviceLightEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceMotionEvent = $pkg.DeviceMotionEvent = $newType(0, $kindStruct, "dom.DeviceMotionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceOrientationEvent = $pkg.DeviceOrientationEvent = $newType(0, $kindStruct, "dom.DeviceOrientationEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceProximityEvent = $pkg.DeviceProximityEvent = $newType(0, $kindStruct, "dom.DeviceProximityEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DOMTransactionEvent = $pkg.DOMTransactionEvent = $newType(0, $kindStruct, "dom.DOMTransactionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DragEvent = $pkg.DragEvent = $newType(0, $kindStruct, "dom.DragEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	EditingBeforeInputEvent = $pkg.EditingBeforeInputEvent = $newType(0, $kindStruct, "dom.EditingBeforeInputEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ErrorEvent = $pkg.ErrorEvent = $newType(0, $kindStruct, "dom.ErrorEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	FocusEvent = $pkg.FocusEvent = $newType(0, $kindStruct, "dom.FocusEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	GamepadEvent = $pkg.GamepadEvent = $newType(0, $kindStruct, "dom.GamepadEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	HashChangeEvent = $pkg.HashChangeEvent = $newType(0, $kindStruct, "dom.HashChangeEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	IDBVersionChangeEvent = $pkg.IDBVersionChangeEvent = $newType(0, $kindStruct, "dom.IDBVersionChangeEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	KeyboardEvent = $pkg.KeyboardEvent = $newType(0, $kindStruct, "dom.KeyboardEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_, AltKey_, CharCode_, CtrlKey_, Key_, KeyIdentifier_, KeyCode_, Locale_, Location_, KeyLocation_, MetaKey_, Repeat_, ShiftKey_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			this.AltKey = false;
			this.CharCode = 0;
			this.CtrlKey = false;
			this.Key = "";
			this.KeyIdentifier = "";
			this.KeyCode = 0;
			this.Locale = "";
			this.Location = 0;
			this.KeyLocation = 0;
			this.MetaKey = false;
			this.Repeat = false;
			this.ShiftKey = false;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.AltKey = AltKey_;
		this.CharCode = CharCode_;
		this.CtrlKey = CtrlKey_;
		this.Key = Key_;
		this.KeyIdentifier = KeyIdentifier_;
		this.KeyCode = KeyCode_;
		this.Locale = Locale_;
		this.Location = Location_;
		this.KeyLocation = KeyLocation_;
		this.MetaKey = MetaKey_;
		this.Repeat = Repeat_;
		this.ShiftKey = ShiftKey_;
	});
	MediaStreamEvent = $pkg.MediaStreamEvent = $newType(0, $kindStruct, "dom.MediaStreamEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	MessageEvent = $pkg.MessageEvent = $newType(0, $kindStruct, "dom.MessageEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_, Data_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			this.Data = null;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.Data = Data_;
	});
	MouseEvent = $pkg.MouseEvent = $newType(0, $kindStruct, "dom.MouseEvent", true, "honnef.co/go/js/dom", true, function(UIEvent_, AltKey_, Button_, ClientX_, ClientY_, CtrlKey_, MetaKey_, MovementX_, MovementY_, ScreenX_, ScreenY_, ShiftKey_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.UIEvent = ptrType$20.nil;
			this.AltKey = false;
			this.Button = 0;
			this.ClientX = 0;
			this.ClientY = 0;
			this.CtrlKey = false;
			this.MetaKey = false;
			this.MovementX = 0;
			this.MovementY = 0;
			this.ScreenX = 0;
			this.ScreenY = 0;
			this.ShiftKey = false;
			return;
		}
		this.UIEvent = UIEvent_;
		this.AltKey = AltKey_;
		this.Button = Button_;
		this.ClientX = ClientX_;
		this.ClientY = ClientY_;
		this.CtrlKey = CtrlKey_;
		this.MetaKey = MetaKey_;
		this.MovementX = MovementX_;
		this.MovementY = MovementY_;
		this.ScreenX = ScreenX_;
		this.ScreenY = ScreenY_;
		this.ShiftKey = ShiftKey_;
	});
	MutationEvent = $pkg.MutationEvent = $newType(0, $kindStruct, "dom.MutationEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	OfflineAudioCompletionEvent = $pkg.OfflineAudioCompletionEvent = $newType(0, $kindStruct, "dom.OfflineAudioCompletionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PageTransitionEvent = $pkg.PageTransitionEvent = $newType(0, $kindStruct, "dom.PageTransitionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PointerEvent = $pkg.PointerEvent = $newType(0, $kindStruct, "dom.PointerEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PopStateEvent = $pkg.PopStateEvent = $newType(0, $kindStruct, "dom.PopStateEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ProgressEvent = $pkg.ProgressEvent = $newType(0, $kindStruct, "dom.ProgressEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	RelatedEvent = $pkg.RelatedEvent = $newType(0, $kindStruct, "dom.RelatedEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	RTCPeerConnectionIceEvent = $pkg.RTCPeerConnectionIceEvent = $newType(0, $kindStruct, "dom.RTCPeerConnectionIceEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SensorEvent = $pkg.SensorEvent = $newType(0, $kindStruct, "dom.SensorEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	StorageEvent = $pkg.StorageEvent = $newType(0, $kindStruct, "dom.StorageEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SVGEvent = $pkg.SVGEvent = $newType(0, $kindStruct, "dom.SVGEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SVGZoomEvent = $pkg.SVGZoomEvent = $newType(0, $kindStruct, "dom.SVGZoomEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TimeEvent = $pkg.TimeEvent = $newType(0, $kindStruct, "dom.TimeEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TouchEvent = $pkg.TouchEvent = $newType(0, $kindStruct, "dom.TouchEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_, AltKey_, CtrlKey_, MetaKey_, ShiftKey_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			this.AltKey = false;
			this.CtrlKey = false;
			this.MetaKey = false;
			this.ShiftKey = false;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.AltKey = AltKey_;
		this.CtrlKey = CtrlKey_;
		this.MetaKey = MetaKey_;
		this.ShiftKey = ShiftKey_;
	});
	Touch = $pkg.Touch = $newType(0, $kindStruct, "dom.Touch", true, "honnef.co/go/js/dom", true, function(Object_, Identifier_, ScreenX_, ScreenY_, ClientX_, ClientY_, PageX_, PageY_, RadiusX_, RadiusY_, RotationAngle_, Force_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Identifier = 0;
			this.ScreenX = 0;
			this.ScreenY = 0;
			this.ClientX = 0;
			this.ClientY = 0;
			this.PageX = 0;
			this.PageY = 0;
			this.RadiusX = 0;
			this.RadiusY = 0;
			this.RotationAngle = 0;
			this.Force = 0;
			return;
		}
		this.Object = Object_;
		this.Identifier = Identifier_;
		this.ScreenX = ScreenX_;
		this.ScreenY = ScreenY_;
		this.ClientX = ClientX_;
		this.ClientY = ClientY_;
		this.PageX = PageX_;
		this.PageY = PageY_;
		this.RadiusX = RadiusX_;
		this.RadiusY = RadiusY_;
		this.RotationAngle = RotationAngle_;
		this.Force = Force_;
	});
	TrackEvent = $pkg.TrackEvent = $newType(0, $kindStruct, "dom.TrackEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TransitionEvent = $pkg.TransitionEvent = $newType(0, $kindStruct, "dom.TransitionEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	UIEvent = $pkg.UIEvent = $newType(0, $kindStruct, "dom.UIEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	UserProximityEvent = $pkg.UserProximityEvent = $newType(0, $kindStruct, "dom.UserProximityEvent", true, "honnef.co/go/js/dom", true, function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$19.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	WheelEvent = $pkg.WheelEvent = $newType(0, $kindStruct, "dom.WheelEvent", true, "honnef.co/go/js/dom", true, function(MouseEvent_, DeltaX_, DeltaY_, DeltaZ_, DeltaMode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MouseEvent = ptrType$21.nil;
			this.DeltaX = 0;
			this.DeltaY = 0;
			this.DeltaZ = 0;
			this.DeltaMode = 0;
			return;
		}
		this.MouseEvent = MouseEvent_;
		this.DeltaX = DeltaX_;
		this.DeltaY = DeltaY_;
		this.DeltaZ = DeltaZ_;
		this.DeltaMode = DeltaMode_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(js.Object);
	sliceType$1 = $sliceType(ptrType);
	sliceType$2 = $sliceType(Node);
	sliceType$3 = $sliceType(Element);
	sliceType$4 = $sliceType(HTMLElement);
	ptrType$1 = $ptrType(BasicHTMLElement);
	ptrType$2 = $ptrType(URLUtils);
	ptrType$3 = $ptrType(HTMLMediaElement);
	ptrType$4 = $ptrType(time.Location);
	ptrType$5 = $ptrType(HTMLFormElement);
	ptrType$6 = $ptrType(HTMLLabelElement);
	sliceType$5 = $sliceType(ptrType$6);
	ptrType$7 = $ptrType(HTMLOptionElement);
	sliceType$6 = $sliceType(ptrType$7);
	sliceType$7 = $sliceType($String);
	sliceType$8 = $sliceType(ptrType$5);
	ptrType$8 = $ptrType(HTMLHeadElement);
	ptrType$9 = $ptrType(HTMLImageElement);
	sliceType$9 = $sliceType(ptrType$9);
	ptrType$10 = $ptrType(HTMLEmbedElement);
	sliceType$10 = $sliceType(ptrType$10);
	ptrType$11 = $ptrType(HTMLScriptElement);
	sliceType$11 = $sliceType(ptrType$11);
	ptrType$12 = $ptrType(Text);
	funcType = $funcType([], [], false);
	funcType$1 = $funcType([ptrType], [], false);
	sliceType$12 = $sliceType($Float64);
	ptrType$13 = $ptrType(ImageData);
	ptrType$14 = $ptrType(File);
	sliceType$13 = $sliceType(ptrType$14);
	ptrType$15 = $ptrType(HTMLDataListElement);
	ptrType$16 = $ptrType(HTMLAreaElement);
	sliceType$14 = $sliceType(ptrType$16);
	ptrType$17 = $ptrType(HTMLTableCellElement);
	sliceType$15 = $sliceType(ptrType$17);
	ptrType$18 = $ptrType(HTMLTableRowElement);
	sliceType$16 = $sliceType(ptrType$18);
	ptrType$19 = $ptrType(BasicEvent);
	ptrType$20 = $ptrType(UIEvent);
	ptrType$21 = $ptrType(MouseEvent);
	ptrType$22 = $ptrType(Touch);
	sliceType$17 = $sliceType(ptrType$22);
	ptrType$23 = $ptrType(TokenList);
	funcType$2 = $funcType([Event], [], false);
	sliceType$18 = $sliceType(StyleSheet);
	ptrType$24 = $ptrType(Location);
	ptrType$25 = $ptrType(BasicNode);
	ptrType$26 = $ptrType(document);
	ptrType$27 = $ptrType(htmlDocument);
	mapType = $mapType($String, $String);
	ptrType$28 = $ptrType(CSSStyleDeclaration);
	ptrType$29 = $ptrType(Console);
	funcType$3 = $funcType([time.Duration], [], false);
	ptrType$30 = $ptrType(Screen);
	ptrType$31 = $ptrType(window);
	funcType$4 = $funcType([Position], [], false);
	funcType$5 = $funcType([PositionError], [], false);
	ptrType$32 = $ptrType(PositionError);
	ptrType$33 = $ptrType(Coordinates);
	ptrType$34 = $ptrType(BasicElement);
	ptrType$35 = $ptrType(HTMLAnchorElement);
	ptrType$36 = $ptrType(HTMLAppletElement);
	ptrType$37 = $ptrType(HTMLBaseElement);
	ptrType$38 = $ptrType(ValidityState);
	ptrType$39 = $ptrType(HTMLButtonElement);
	ptrType$40 = $ptrType(CanvasRenderingContext2D);
	ptrType$41 = $ptrType(HTMLCanvasElement);
	ptrType$42 = $ptrType(TextMetrics);
	ptrType$43 = $ptrType(CanvasGradient);
	ptrType$44 = $ptrType(CanvasPattern);
	ptrType$45 = $ptrType(HTMLFieldSetElement);
	ptrType$46 = $ptrType(HTMLIFrameElement);
	ptrType$47 = $ptrType(HTMLInputElement);
	ptrType$48 = $ptrType(HTMLKeygenElement);
	ptrType$49 = $ptrType(HTMLLegendElement);
	ptrType$50 = $ptrType(HTMLLinkElement);
	ptrType$51 = $ptrType(HTMLMapElement);
	ptrType$52 = $ptrType(HTMLObjectElement);
	ptrType$53 = $ptrType(HTMLOutputElement);
	ptrType$54 = $ptrType(HTMLSelectElement);
	ptrType$55 = $ptrType(HTMLTableSectionElement);
	ptrType$56 = $ptrType(HTMLTemplateElement);
	ptrType$57 = $ptrType(HTMLTextAreaElement);
	ptrType$58 = $ptrType(TextTrack);
	ptrType$59 = $ptrType(HTMLTrackElement);
	ptrType$60 = $ptrType(FocusEvent);
	ptrType$61 = $ptrType(KeyboardEvent);
	ptrType$62 = $ptrType(TouchEvent);
	toString = function(o) {
		var o;
		if (o === null || o === undefined) {
			return "";
		}
		return $internalize(o, $String);
	};
	callRecover = function(o, fn, args) {
		var args, err, fn, o, obj, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		$deferred.push([(function() {
			var _tuple, e, ok, panicErr;
			e = $recover();
			if ($interfaceIsEqual(e, $ifaceNil)) {
				return;
			}
			_tuple = $assertType(e, $error, true);
			panicErr = _tuple[0];
			ok = _tuple[1];
			if (ok && !($interfaceIsEqual(panicErr, $ifaceNil))) {
				err = panicErr;
			} else {
				$panic(e);
			}
		}), []]);
		(obj = o, obj[$externalize(fn, $String)].apply(obj, $externalize(args, sliceType)));
		err = $ifaceNil;
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	elementConstructor = function(o) {
		var n, o;
		n = o.node;
		if (!(n === undefined)) {
			return n.constructor;
		}
		return o.constructor;
	};
	arrayToObjects = function(o) {
		var i, o, out;
		out = sliceType$1.nil;
		i = 0;
		while (true) {
			if (!(i < $parseInt(o.length))) { break; }
			out = $append(out, o[i]);
			i = i + (1) >> 0;
		}
		return out;
	};
	nodeListToObjects = function(o) {
		var i, length, o, out;
		if (o.constructor === $global.Array) {
			return arrayToObjects(o);
		}
		out = sliceType$1.nil;
		length = $parseInt(o.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			out = $append(out, o.item(i));
			i = i + (1) >> 0;
		}
		return out;
	};
	nodeListToNodes = function(o) {
		var _i, _ref, o, obj, out;
		out = sliceType$2.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapNode(obj));
			_i++;
		}
		return out;
	};
	nodeListToElements = function(o) {
		var _i, _ref, o, obj, out;
		out = sliceType$3.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapElement(obj));
			_i++;
		}
		return out;
	};
	nodeListToHTMLElements = function(o) {
		var _i, _ref, o, obj, out;
		out = sliceType$4.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapHTMLElement(obj));
			_i++;
		}
		return out;
	};
	wrapDocument = function(o) {
		var _1, o;
		_1 = elementConstructor(o);
		if (_1 === ($global.HTMLDocument)) {
			return new htmlDocument.ptr(new document.ptr(new BasicNode.ptr(o)));
		} else {
			return new document.ptr(new BasicNode.ptr(o));
		}
	};
	wrapDocumentFragment = function(o) {
		var o;
		$unused(elementConstructor(o));
		return new documentFragment.ptr(new BasicNode.ptr(o));
	};
	wrapNode = function(o) {
		var _1, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		_1 = elementConstructor(o);
		if (_1 === ($global.Text)) {
			return new Text.ptr(new BasicNode.ptr(o));
		} else {
			return wrapElement(o);
		}
	};
	wrapElement = function(o) {
		var o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		$unused(elementConstructor(o));
		return wrapHTMLElement(o);
	};
	wrapHTMLElement = function(o) {
		var _1, c, el, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		el = new BasicHTMLElement.ptr(new BasicElement.ptr(new BasicNode.ptr(o)));
		c = elementConstructor(o);
		_1 = c;
		if (_1 === ($global.HTMLAnchorElement)) {
			return new HTMLAnchorElement.ptr(el, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""), "", "", 0, "", "", "");
		} else if (_1 === ($global.HTMLAppletElement)) {
			return new HTMLAppletElement.ptr(el, "", "", "", "", "", "", 0, "", "");
		} else if (_1 === ($global.HTMLAreaElement)) {
			return new HTMLAreaElement.ptr(el, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""), "", "", "", "", "", "", 0, "", "");
		} else if (_1 === ($global.HTMLAudioElement)) {
			return new HTMLAudioElement.ptr(new HTMLMediaElement.ptr(el, false));
		} else if (_1 === ($global.HTMLBaseElement)) {
			return new HTMLBaseElement.ptr(el);
		} else if (_1 === ($global.HTMLBodyElement)) {
			return new HTMLBodyElement.ptr(el);
		} else if (_1 === ($global.HTMLBRElement)) {
			return new HTMLBRElement.ptr(el);
		} else if (_1 === ($global.HTMLButtonElement)) {
			return new HTMLButtonElement.ptr(el, false, false, "", "", "", false, "", "", 0, "", "", "", false);
		} else if (_1 === ($global.HTMLCanvasElement)) {
			return new HTMLCanvasElement.ptr(el, 0, 0);
		} else if (_1 === ($global.HTMLDataElement)) {
			return new HTMLDataElement.ptr(el, "");
		} else if (_1 === ($global.HTMLDataListElement)) {
			return new HTMLDataListElement.ptr(el);
		} else if (_1 === ($global.HTMLDirectoryElement)) {
			return new HTMLDirectoryElement.ptr(el);
		} else if (_1 === ($global.HTMLDivElement)) {
			return new HTMLDivElement.ptr(el);
		} else if (_1 === ($global.HTMLDListElement)) {
			return new HTMLDListElement.ptr(el);
		} else if (_1 === ($global.HTMLEmbedElement)) {
			return new HTMLEmbedElement.ptr(el, "", "", "");
		} else if (_1 === ($global.HTMLFieldSetElement)) {
			return new HTMLFieldSetElement.ptr(el, false, "", "", "", false);
		} else if (_1 === ($global.HTMLFontElement)) {
			return new HTMLFontElement.ptr(el);
		} else if (_1 === ($global.HTMLFormElement)) {
			return new HTMLFormElement.ptr(el, "", "", "", "", "", 0, "", "", false, "");
		} else if (_1 === ($global.HTMLFrameElement)) {
			return new HTMLFrameElement.ptr(el);
		} else if (_1 === ($global.HTMLFrameSetElement)) {
			return new HTMLFrameSetElement.ptr(el);
		} else if (_1 === ($global.HTMLHeadElement)) {
			return new HTMLHeadElement.ptr(el);
		} else if (_1 === ($global.HTMLHeadingElement)) {
			return new HTMLHeadingElement.ptr(el);
		} else if (_1 === ($global.HTMLHtmlElement)) {
			return new HTMLHtmlElement.ptr(el);
		} else if (_1 === ($global.HTMLHRElement)) {
			return new HTMLHRElement.ptr(el);
		} else if (_1 === ($global.HTMLIFrameElement)) {
			return new HTMLIFrameElement.ptr(el, "", "", "", "", "", false);
		} else if (_1 === ($global.HTMLImageElement)) {
			return new HTMLImageElement.ptr(el, false, "", 0, false, 0, 0, "", "", 0);
		} else if (_1 === ($global.HTMLInputElement)) {
			return new HTMLInputElement.ptr(el, "", "", "", false, false, false, "", "", false, "", "", "", false, "", "", false, "", 0, "", false, "", "", "", false, false, "", 0, 0, 0, "", "", 0, "", "", "", new time.Time.ptr(new $Uint64(0, 0), new $Int64(0, 0), ptrType$4.nil), 0, "", false);
		} else if (_1 === ($global.HTMLKeygenElement)) {
			return new HTMLKeygenElement.ptr(el, false, "", false, "", "", "", "", false);
		} else if (_1 === ($global.HTMLLabelElement)) {
			return new HTMLLabelElement.ptr(el, "");
		} else if (_1 === ($global.HTMLLegendElement)) {
			return new HTMLLegendElement.ptr(el);
		} else if (_1 === ($global.HTMLLIElement)) {
			return new HTMLLIElement.ptr(el, 0);
		} else if (_1 === ($global.HTMLLinkElement)) {
			return new HTMLLinkElement.ptr(el, false, "", "", "", "");
		} else if (_1 === ($global.HTMLMapElement)) {
			return new HTMLMapElement.ptr(el, "");
		} else if (_1 === ($global.HTMLMediaElement)) {
			return new HTMLMediaElement.ptr(el, false);
		} else if (_1 === ($global.HTMLMenuElement)) {
			return new HTMLMenuElement.ptr(el);
		} else if (_1 === ($global.HTMLMetaElement)) {
			return new HTMLMetaElement.ptr(el, "", "", "");
		} else if (_1 === ($global.HTMLMeterElement)) {
			return new HTMLMeterElement.ptr(el, 0, 0, 0, 0, 0);
		} else if (_1 === ($global.HTMLModElement)) {
			return new HTMLModElement.ptr(el, "", "");
		} else if (_1 === ($global.HTMLObjectElement)) {
			return new HTMLObjectElement.ptr(el, "", "", "", 0, "", false, "", "", "", false);
		} else if (_1 === ($global.HTMLOListElement)) {
			return new HTMLOListElement.ptr(el, false, 0, "");
		} else if (_1 === ($global.HTMLOptGroupElement)) {
			return new HTMLOptGroupElement.ptr(el, false, "");
		} else if (_1 === ($global.HTMLOptionElement)) {
			return new HTMLOptionElement.ptr(el, false, false, 0, "", false, "", "");
		} else if (_1 === ($global.HTMLOutputElement)) {
			return new HTMLOutputElement.ptr(el, "", "", "", "", "", false);
		} else if (_1 === ($global.HTMLParagraphElement)) {
			return new HTMLParagraphElement.ptr(el);
		} else if (_1 === ($global.HTMLParamElement)) {
			return new HTMLParamElement.ptr(el, "", "");
		} else if (_1 === ($global.HTMLPreElement)) {
			return new HTMLPreElement.ptr(el);
		} else if (_1 === ($global.HTMLProgressElement)) {
			return new HTMLProgressElement.ptr(el, 0, 0, 0);
		} else if (_1 === ($global.HTMLQuoteElement)) {
			return new HTMLQuoteElement.ptr(el, "");
		} else if (_1 === ($global.HTMLScriptElement)) {
			return new HTMLScriptElement.ptr(el, "", "", "", false, false, "");
		} else if (_1 === ($global.HTMLSelectElement)) {
			return new HTMLSelectElement.ptr(el, false, false, 0, false, "", false, 0, 0, "", "", "", false);
		} else if (_1 === ($global.HTMLSourceElement)) {
			return new HTMLSourceElement.ptr(el, "", "", "");
		} else if (_1 === ($global.HTMLSpanElement)) {
			return new HTMLSpanElement.ptr(el);
		} else if (_1 === ($global.HTMLStyleElement)) {
			return new HTMLStyleElement.ptr(el);
		} else if (_1 === ($global.HTMLTableElement)) {
			return new HTMLTableElement.ptr(el);
		} else if (_1 === ($global.HTMLTableCaptionElement)) {
			return new HTMLTableCaptionElement.ptr(el);
		} else if (_1 === ($global.HTMLTableCellElement)) {
			return new HTMLTableCellElement.ptr(el, 0, 0, 0);
		} else if (_1 === ($global.HTMLTableDataCellElement)) {
			return new HTMLTableDataCellElement.ptr(el);
		} else if (_1 === ($global.HTMLTableHeaderCellElement)) {
			return new HTMLTableHeaderCellElement.ptr(el, "", "");
		} else if (_1 === ($global.HTMLTableColElement)) {
			return new HTMLTableColElement.ptr(el, 0);
		} else if (_1 === ($global.HTMLTableRowElement)) {
			return new HTMLTableRowElement.ptr(el, 0, 0);
		} else if (_1 === ($global.HTMLTableSectionElement)) {
			return new HTMLTableSectionElement.ptr(el);
		} else if (_1 === ($global.HTMLTemplateElement)) {
			return new HTMLTemplateElement.ptr(el);
		} else if (_1 === ($global.HTMLTextAreaElement)) {
			return new HTMLTextAreaElement.ptr(el, "", false, 0, "", "", false, 0, "", "", false, false, 0, "", 0, 0, 0, 0, "", "", "", false, "");
		} else if (_1 === ($global.HTMLTimeElement)) {
			return new HTMLTimeElement.ptr(el, "");
		} else if (_1 === ($global.HTMLTitleElement)) {
			return new HTMLTitleElement.ptr(el, "");
		} else if (_1 === ($global.HTMLTrackElement)) {
			return new HTMLTrackElement.ptr(el, "", "", "", "", false, 0);
		} else if (_1 === ($global.HTMLUListElement)) {
			return new HTMLUListElement.ptr(el);
		} else if (_1 === ($global.HTMLUnknownElement)) {
			return new HTMLUnknownElement.ptr(el);
		} else if (_1 === ($global.HTMLVideoElement)) {
			return new HTMLVideoElement.ptr(new HTMLMediaElement.ptr(el, false));
		} else if (_1 === ($global.HTMLElement)) {
			return el;
		} else {
			return el;
		}
	};
	getForm = function(o) {
		var form, o;
		form = wrapHTMLElement(o.form);
		if ($interfaceIsEqual(form, $ifaceNil)) {
			return ptrType$5.nil;
		}
		return $assertType(form, ptrType$5);
	};
	getLabels = function(o) {
		var _i, _ref, i, label, labels, o, out;
		labels = nodeListToElements(o.labels);
		out = $makeSlice(sliceType$5, labels.$length);
		_ref = labels;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			label = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = $assertType(label, ptrType$6));
			_i++;
		}
		return out;
	};
	getOptions = function(o, attr) {
		var _i, _ref, attr, i, o, option, options, out;
		options = nodeListToElements(o[$externalize(attr, $String)]);
		out = $makeSlice(sliceType$6, options.$length);
		_ref = options;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			option = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = $assertType(option, ptrType$7));
			_i++;
		}
		return out;
	};
	GetWindow = function() {
		return new window.ptr($global);
	};
	$pkg.GetWindow = GetWindow;
	TokenList.ptr.prototype.Item = function(idx) {
		var idx, o, tl;
		tl = this;
		o = tl.dtl.item(idx);
		return toString(o);
	};
	TokenList.prototype.Item = function(idx) { return this.$val.Item(idx); };
	TokenList.ptr.prototype.Contains = function(token) {
		var tl, token;
		tl = this;
		return !!(tl.dtl.contains($externalize(token, $String)));
	};
	TokenList.prototype.Contains = function(token) { return this.$val.Contains(token); };
	TokenList.ptr.prototype.Add = function(token) {
		var tl, token;
		tl = this;
		tl.dtl.add($externalize(token, $String));
	};
	TokenList.prototype.Add = function(token) { return this.$val.Add(token); };
	TokenList.ptr.prototype.Remove = function(token) {
		var tl, token;
		tl = this;
		tl.dtl.remove($externalize(token, $String));
	};
	TokenList.prototype.Remove = function(token) { return this.$val.Remove(token); };
	TokenList.ptr.prototype.Toggle = function(token) {
		var tl, token;
		tl = this;
		tl.dtl.toggle($externalize(token, $String));
	};
	TokenList.prototype.Toggle = function(token) { return this.$val.Toggle(token); };
	TokenList.ptr.prototype.String = function() {
		var tl;
		tl = this;
		if (!(tl.sa === "")) {
			return $internalize(tl.o[$externalize(tl.sa, $String)], $String);
		}
		if (tl.dtl.constructor === $global.DOMSettableTokenList) {
			return $internalize(tl.dtl.value, $String);
		}
		return "";
	};
	TokenList.prototype.String = function() { return this.$val.String(); };
	TokenList.ptr.prototype.Slice = function() {
		var i, length, out, tl;
		tl = this;
		out = sliceType$7.nil;
		length = $parseInt(tl.dtl.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			out = $append(out, $internalize(tl.dtl.item(i), $String));
			i = i + (1) >> 0;
		}
		return out;
	};
	TokenList.prototype.Slice = function() { return this.$val.Slice(); };
	TokenList.ptr.prototype.SetString = function(s) {
		var s, tl;
		tl = this;
		if (!(tl.sa === "")) {
			tl.o[$externalize(tl.sa, $String)] = $externalize(s, $String);
			return;
		}
		if (tl.dtl.constructor === $global.DOMSettableTokenList) {
			tl.dtl.value = $externalize(s, $String);
			return;
		}
		$panic(new $String("no way to SetString on this TokenList"));
	};
	TokenList.prototype.SetString = function(s) { return this.$val.SetString(s); };
	TokenList.ptr.prototype.Set = function(s) {
		var s, tl;
		tl = this;
		tl.SetString(strings.Join(s, " "));
	};
	TokenList.prototype.Set = function(s) { return this.$val.Set(s); };
	documentFragment.ptr.prototype.GetElementByID = function(id) {
		var d, id;
		d = this;
		return wrapElement(d.BasicNode.Object.getElementById($externalize(id, $String)));
	};
	documentFragment.prototype.GetElementByID = function(id) { return this.$val.GetElementByID(id); };
	documentFragment.ptr.prototype.QuerySelector = function(sel) {
		var d, sel;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelector(sel);
	};
	documentFragment.prototype.QuerySelector = function(sel) { return this.$val.QuerySelector(sel); };
	documentFragment.ptr.prototype.QuerySelectorAll = function(sel) {
		var d, sel;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelectorAll(sel);
	};
	documentFragment.prototype.QuerySelectorAll = function(sel) { return this.$val.QuerySelectorAll(sel); };
	htmlDocument.ptr.prototype.ActiveElement = function() {
		var d;
		d = this;
		return wrapHTMLElement(d.document.BasicNode.Object.activeElement);
	};
	htmlDocument.prototype.ActiveElement = function() { return this.$val.ActiveElement(); };
	htmlDocument.ptr.prototype.Body = function() {
		var d;
		d = this;
		return wrapHTMLElement(d.document.BasicNode.Object.body);
	};
	htmlDocument.prototype.Body = function() { return this.$val.Body(); };
	htmlDocument.ptr.prototype.Cookie = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.cookie, $String);
	};
	htmlDocument.prototype.Cookie = function() { return this.$val.Cookie(); };
	htmlDocument.ptr.prototype.SetCookie = function(s) {
		var d, s;
		d = this;
		d.document.BasicNode.Object.cookie = $externalize(s, $String);
	};
	htmlDocument.prototype.SetCookie = function(s) { return this.$val.SetCookie(s); };
	htmlDocument.ptr.prototype.DefaultView = function() {
		var d;
		d = this;
		return new window.ptr(d.document.BasicNode.Object.defaultView);
	};
	htmlDocument.prototype.DefaultView = function() { return this.$val.DefaultView(); };
	htmlDocument.ptr.prototype.DesignMode = function() {
		var d, s;
		d = this;
		s = $internalize(d.document.BasicNode.Object.designMode, $String);
		return !(s === "off");
	};
	htmlDocument.prototype.DesignMode = function() { return this.$val.DesignMode(); };
	htmlDocument.ptr.prototype.SetDesignMode = function(b) {
		var b, d, s;
		d = this;
		s = "off";
		if (b) {
			s = "on";
		}
		d.document.BasicNode.Object.designMode = $externalize(s, $String);
	};
	htmlDocument.prototype.SetDesignMode = function(b) { return this.$val.SetDesignMode(b); };
	htmlDocument.ptr.prototype.Domain = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.domain, $String);
	};
	htmlDocument.prototype.Domain = function() { return this.$val.Domain(); };
	htmlDocument.ptr.prototype.SetDomain = function(s) {
		var d, s;
		d = this;
		d.document.BasicNode.Object.domain = $externalize(s, $String);
	};
	htmlDocument.prototype.SetDomain = function(s) { return this.$val.SetDomain(s); };
	htmlDocument.ptr.prototype.Forms = function() {
		var d, els, forms, i, length;
		d = this;
		els = sliceType$8.nil;
		forms = d.document.BasicNode.Object.forms;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$5));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Forms = function() { return this.$val.Forms(); };
	htmlDocument.ptr.prototype.Head = function() {
		var d, head;
		d = this;
		head = wrapElement(d.document.BasicNode.Object.head);
		if ($interfaceIsEqual(head, $ifaceNil)) {
			return ptrType$8.nil;
		}
		return $assertType(head, ptrType$8);
	};
	htmlDocument.prototype.Head = function() { return this.$val.Head(); };
	htmlDocument.ptr.prototype.Images = function() {
		var d, els, i, images, length;
		d = this;
		els = sliceType$9.nil;
		images = d.document.BasicNode.Object.images;
		length = $parseInt(images.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(images.item(i)), ptrType$9));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Images = function() { return this.$val.Images(); };
	htmlDocument.ptr.prototype.LastModified = function() {
		var d;
		d = this;
		return $assertType($internalize(d.document.BasicNode.Object.lastModified, $emptyInterface), time.Time);
	};
	htmlDocument.prototype.LastModified = function() { return this.$val.LastModified(); };
	htmlDocument.ptr.prototype.Links = function() {
		var d, els, i, length, links;
		d = this;
		els = sliceType$4.nil;
		links = d.document.BasicNode.Object.links;
		length = $parseInt(links.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, wrapHTMLElement(links.item(i)));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Links = function() { return this.$val.Links(); };
	htmlDocument.ptr.prototype.Location = function() {
		var d, o;
		d = this;
		o = d.document.BasicNode.Object.location;
		return new Location.ptr(o, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""));
	};
	htmlDocument.prototype.Location = function() { return this.$val.Location(); };
	htmlDocument.ptr.prototype.Plugins = function() {
		var d, els, forms, i, length;
		d = this;
		els = sliceType$10.nil;
		forms = d.document.BasicNode.Object.plugins;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$10));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Plugins = function() { return this.$val.Plugins(); };
	htmlDocument.ptr.prototype.ReadyState = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.readyState, $String);
	};
	htmlDocument.prototype.ReadyState = function() { return this.$val.ReadyState(); };
	htmlDocument.ptr.prototype.Referrer = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.referrer, $String);
	};
	htmlDocument.prototype.Referrer = function() { return this.$val.Referrer(); };
	htmlDocument.ptr.prototype.Scripts = function() {
		var d, els, forms, i, length;
		d = this;
		els = sliceType$11.nil;
		forms = d.document.BasicNode.Object.scripts;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$11));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Scripts = function() { return this.$val.Scripts(); };
	htmlDocument.ptr.prototype.Title = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.title, $String);
	};
	htmlDocument.prototype.Title = function() { return this.$val.Title(); };
	htmlDocument.ptr.prototype.SetTitle = function(s) {
		var d, s;
		d = this;
		d.document.BasicNode.Object.title = $externalize(s, $String);
	};
	htmlDocument.prototype.SetTitle = function(s) { return this.$val.SetTitle(s); };
	htmlDocument.ptr.prototype.URL = function() {
		var d;
		d = this;
		return $internalize(d.document.BasicNode.Object.URL, $String);
	};
	htmlDocument.prototype.URL = function() { return this.$val.URL(); };
	document.ptr.prototype.Async = function() {
		var d;
		d = this;
		return !!(d.BasicNode.Object.async);
	};
	document.prototype.Async = function() { return this.$val.Async(); };
	document.ptr.prototype.SetAsync = function(b) {
		var b, d;
		d = this;
		d.BasicNode.Object.async = $externalize(b, $Bool);
	};
	document.prototype.SetAsync = function(b) { return this.$val.SetAsync(b); };
	document.ptr.prototype.Doctype = function() {
		var d;
		d = this;
		$panic(new $String("not implemented"));
	};
	document.prototype.Doctype = function() { return this.$val.Doctype(); };
	document.ptr.prototype.DocumentElement = function() {
		var d;
		d = this;
		return wrapElement(d.BasicNode.Object.documentElement);
	};
	document.prototype.DocumentElement = function() { return this.$val.DocumentElement(); };
	document.ptr.prototype.DocumentURI = function() {
		var d;
		d = this;
		return $internalize(d.BasicNode.Object.documentURI, $String);
	};
	document.prototype.DocumentURI = function() { return this.$val.DocumentURI(); };
	document.ptr.prototype.Implementation = function() {
		var d;
		d = this;
		$panic(new $String("not implemented"));
	};
	document.prototype.Implementation = function() { return this.$val.Implementation(); };
	document.ptr.prototype.LastStyleSheetSet = function() {
		var d;
		d = this;
		return $internalize(d.BasicNode.Object.lastStyleSheetSet, $String);
	};
	document.prototype.LastStyleSheetSet = function() { return this.$val.LastStyleSheetSet(); };
	document.ptr.prototype.PreferredStyleSheetSet = function() {
		var d;
		d = this;
		return $internalize(d.BasicNode.Object.preferredStyleSheetSet, $String);
	};
	document.prototype.PreferredStyleSheetSet = function() { return this.$val.PreferredStyleSheetSet(); };
	document.ptr.prototype.SelectedStyleSheetSet = function() {
		var d;
		d = this;
		return $internalize(d.BasicNode.Object.selectedStyleSheetSet, $String);
	};
	document.prototype.SelectedStyleSheetSet = function() { return this.$val.SelectedStyleSheetSet(); };
	document.ptr.prototype.StyleSheets = function() {
		var d;
		d = this;
		$panic(new $String("not implemented"));
	};
	document.prototype.StyleSheets = function() { return this.$val.StyleSheets(); };
	document.ptr.prototype.StyleSheetSets = function() {
		var d;
		d = this;
		$panic(new $String("not implemented"));
	};
	document.prototype.StyleSheetSets = function() { return this.$val.StyleSheetSets(); };
	document.ptr.prototype.AdoptNode = function(node) {
		var _r, _r$1, d, node, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; d = $f.d; node = $f.node; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_r = node.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = wrapNode(d.BasicNode.Object.adoptNode(_r)); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: document.ptr.prototype.AdoptNode }; } $f._r = _r; $f._r$1 = _r$1; $f.d = d; $f.node = node; $f.$s = $s; $f.$r = $r; return $f;
	};
	document.prototype.AdoptNode = function(node) { return this.$val.AdoptNode(node); };
	document.ptr.prototype.ImportNode = function(node, deep) {
		var _r, _r$1, d, deep, node, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; d = $f.d; deep = $f.deep; node = $f.node; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_r = node.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = wrapNode(d.BasicNode.Object.importNode(_r, $externalize(deep, $Bool))); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: document.ptr.prototype.ImportNode }; } $f._r = _r; $f._r$1 = _r$1; $f.d = d; $f.deep = deep; $f.node = node; $f.$s = $s; $f.$r = $r; return $f;
	};
	document.prototype.ImportNode = function(node, deep) { return this.$val.ImportNode(node, deep); };
	document.ptr.prototype.CreateDocumentFragment = function() {
		var d;
		d = this;
		return wrapDocumentFragment(d.BasicNode.Object.createDocumentFragment());
	};
	document.prototype.CreateDocumentFragment = function() { return this.$val.CreateDocumentFragment(); };
	document.ptr.prototype.CreateElement = function(name) {
		var d, name;
		d = this;
		return wrapElement(d.BasicNode.Object.createElement($externalize(name, $String)));
	};
	document.prototype.CreateElement = function(name) { return this.$val.CreateElement(name); };
	document.ptr.prototype.CreateElementNS = function(ns, name) {
		var d, name, ns;
		d = this;
		return wrapElement(d.BasicNode.Object.createElementNS($externalize(ns, $String), $externalize(name, $String)));
	};
	document.prototype.CreateElementNS = function(ns, name) { return this.$val.CreateElementNS(ns, name); };
	document.ptr.prototype.CreateTextNode = function(s) {
		var d, s;
		d = this;
		return $assertType(wrapNode(d.BasicNode.Object.createTextNode($externalize(s, $String))), ptrType$12);
	};
	document.prototype.CreateTextNode = function(s) { return this.$val.CreateTextNode(s); };
	document.ptr.prototype.ElementFromPoint = function(x, y) {
		var d, x, y;
		d = this;
		return wrapElement(d.BasicNode.Object.elementFromPoint(x, y));
	};
	document.prototype.ElementFromPoint = function(x, y) { return this.$val.ElementFromPoint(x, y); };
	document.ptr.prototype.EnableStyleSheetsForSet = function(name) {
		var d, name;
		d = this;
		d.BasicNode.Object.enableStyleSheetsForSet($externalize(name, $String));
	};
	document.prototype.EnableStyleSheetsForSet = function(name) { return this.$val.EnableStyleSheetsForSet(name); };
	document.ptr.prototype.GetElementsByClassName = function(name) {
		var d, name;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByClassName(name);
	};
	document.prototype.GetElementsByClassName = function(name) { return this.$val.GetElementsByClassName(name); };
	document.ptr.prototype.GetElementsByTagName = function(name) {
		var d, name;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByTagName(name);
	};
	document.prototype.GetElementsByTagName = function(name) { return this.$val.GetElementsByTagName(name); };
	document.ptr.prototype.GetElementsByTagNameNS = function(ns, name) {
		var d, name, ns;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByTagNameNS(ns, name);
	};
	document.prototype.GetElementsByTagNameNS = function(ns, name) { return this.$val.GetElementsByTagNameNS(ns, name); };
	document.ptr.prototype.GetElementByID = function(id) {
		var d, id;
		d = this;
		return wrapElement(d.BasicNode.Object.getElementById($externalize(id, $String)));
	};
	document.prototype.GetElementByID = function(id) { return this.$val.GetElementByID(id); };
	document.ptr.prototype.QuerySelector = function(sel) {
		var d, sel;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelector(sel);
	};
	document.prototype.QuerySelector = function(sel) { return this.$val.QuerySelector(sel); };
	document.ptr.prototype.QuerySelectorAll = function(sel) {
		var d, sel;
		d = this;
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelectorAll(sel);
	};
	document.prototype.QuerySelectorAll = function(sel) { return this.$val.QuerySelectorAll(sel); };
	window.ptr.prototype.Console = function() {
		var w;
		w = this;
		return new Console.ptr(w.Object.console);
	};
	window.prototype.Console = function() { return this.$val.Console(); };
	window.ptr.prototype.Document = function() {
		var w;
		w = this;
		return wrapDocument(w.Object.document);
	};
	window.prototype.Document = function() { return this.$val.Document(); };
	window.ptr.prototype.FrameElement = function() {
		var w;
		w = this;
		return wrapElement(w.Object.frameElement);
	};
	window.prototype.FrameElement = function() { return this.$val.FrameElement(); };
	window.ptr.prototype.Location = function() {
		var o, w;
		w = this;
		o = w.Object.location;
		return new Location.ptr(o, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""));
	};
	window.prototype.Location = function() { return this.$val.Location(); };
	window.ptr.prototype.Name = function() {
		var w;
		w = this;
		return $internalize(w.Object.name, $String);
	};
	window.prototype.Name = function() { return this.$val.Name(); };
	window.ptr.prototype.SetName = function(s) {
		var s, w;
		w = this;
		w.Object.name = $externalize(s, $String);
	};
	window.prototype.SetName = function(s) { return this.$val.SetName(s); };
	window.ptr.prototype.InnerHeight = function() {
		var w;
		w = this;
		return $parseInt(w.Object.innerHeight) >> 0;
	};
	window.prototype.InnerHeight = function() { return this.$val.InnerHeight(); };
	window.ptr.prototype.InnerWidth = function() {
		var w;
		w = this;
		return $parseInt(w.Object.innerWidth) >> 0;
	};
	window.prototype.InnerWidth = function() { return this.$val.InnerWidth(); };
	window.ptr.prototype.Length = function() {
		var w;
		w = this;
		return $parseInt(w.Object.length) >> 0;
	};
	window.prototype.Length = function() { return this.$val.Length(); };
	window.ptr.prototype.Opener = function() {
		var w;
		w = this;
		return new window.ptr(w.Object.opener);
	};
	window.prototype.Opener = function() { return this.$val.Opener(); };
	window.ptr.prototype.OuterHeight = function() {
		var w;
		w = this;
		return $parseInt(w.Object.outerHeight) >> 0;
	};
	window.prototype.OuterHeight = function() { return this.$val.OuterHeight(); };
	window.ptr.prototype.OuterWidth = function() {
		var w;
		w = this;
		return $parseInt(w.Object.outerWidth) >> 0;
	};
	window.prototype.OuterWidth = function() { return this.$val.OuterWidth(); };
	window.ptr.prototype.ScrollX = function() {
		var w;
		w = this;
		return $parseInt(w.Object.scrollX) >> 0;
	};
	window.prototype.ScrollX = function() { return this.$val.ScrollX(); };
	window.ptr.prototype.ScrollY = function() {
		var w;
		w = this;
		return $parseInt(w.Object.scrollY) >> 0;
	};
	window.prototype.ScrollY = function() { return this.$val.ScrollY(); };
	window.ptr.prototype.Parent = function() {
		var w;
		w = this;
		return new window.ptr(w.Object.parent);
	};
	window.prototype.Parent = function() { return this.$val.Parent(); };
	window.ptr.prototype.ScreenX = function() {
		var w;
		w = this;
		return $parseInt(w.Object.screenX) >> 0;
	};
	window.prototype.ScreenX = function() { return this.$val.ScreenX(); };
	window.ptr.prototype.ScreenY = function() {
		var w;
		w = this;
		return $parseInt(w.Object.screenY) >> 0;
	};
	window.prototype.ScreenY = function() { return this.$val.ScreenY(); };
	window.ptr.prototype.ScrollMaxX = function() {
		var w;
		w = this;
		return $parseInt(w.Object.scrollMaxX) >> 0;
	};
	window.prototype.ScrollMaxX = function() { return this.$val.ScrollMaxX(); };
	window.ptr.prototype.ScrollMaxY = function() {
		var w;
		w = this;
		return $parseInt(w.Object.scrollMaxY) >> 0;
	};
	window.prototype.ScrollMaxY = function() { return this.$val.ScrollMaxY(); };
	window.ptr.prototype.Top = function() {
		var w;
		w = this;
		return new window.ptr(w.Object.top);
	};
	window.prototype.Top = function() { return this.$val.Top(); };
	window.ptr.prototype.History = function() {
		var w;
		w = this;
		return $ifaceNil;
	};
	window.prototype.History = function() { return this.$val.History(); };
	window.ptr.prototype.Navigator = function() {
		var w;
		w = this;
		$panic(new $String("not implemented"));
	};
	window.prototype.Navigator = function() { return this.$val.Navigator(); };
	window.ptr.prototype.Screen = function() {
		var w;
		w = this;
		return new Screen.ptr(w.Object.screen, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	};
	window.prototype.Screen = function() { return this.$val.Screen(); };
	window.ptr.prototype.Alert = function(msg) {
		var msg, w;
		w = this;
		w.Object.alert($externalize(msg, $String));
	};
	window.prototype.Alert = function(msg) { return this.$val.Alert(msg); };
	window.ptr.prototype.Back = function() {
		var w;
		w = this;
		w.Object.back();
	};
	window.prototype.Back = function() { return this.$val.Back(); };
	window.ptr.prototype.Blur = function() {
		var w;
		w = this;
		w.Object.blur();
	};
	window.prototype.Blur = function() { return this.$val.Blur(); };
	window.ptr.prototype.ClearInterval = function(id) {
		var id, w;
		w = this;
		w.Object.clearInterval(id);
	};
	window.prototype.ClearInterval = function(id) { return this.$val.ClearInterval(id); };
	window.ptr.prototype.ClearTimeout = function(id) {
		var id, w;
		w = this;
		w.Object.clearTimeout(id);
	};
	window.prototype.ClearTimeout = function(id) { return this.$val.ClearTimeout(id); };
	window.ptr.prototype.Close = function() {
		var w;
		w = this;
		w.Object.close();
	};
	window.prototype.Close = function() { return this.$val.Close(); };
	window.ptr.prototype.Confirm = function(prompt) {
		var prompt, w;
		w = this;
		return !!(w.Object.confirm($externalize(prompt, $String)));
	};
	window.prototype.Confirm = function(prompt) { return this.$val.Confirm(prompt); };
	window.ptr.prototype.Focus = function() {
		var w;
		w = this;
		w.Object.focus();
	};
	window.prototype.Focus = function() { return this.$val.Focus(); };
	window.ptr.prototype.Forward = function() {
		var w;
		w = this;
		w.Object.forward();
	};
	window.prototype.Forward = function() { return this.$val.Forward(); };
	window.ptr.prototype.GetComputedStyle = function(el, pseudoElt) {
		var _r, el, optArg, pseudoElt, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; el = $f.el; optArg = $f.optArg; pseudoElt = $f.pseudoElt; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		w = this;
		optArg = $ifaceNil;
		if (!(pseudoElt === "")) {
			optArg = new $String(pseudoElt);
		}
		_r = el.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return new CSSStyleDeclaration.ptr(w.Object.getComputedStyle(_r, $externalize(optArg, $emptyInterface)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: window.ptr.prototype.GetComputedStyle }; } $f._r = _r; $f.el = el; $f.optArg = optArg; $f.pseudoElt = pseudoElt; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	window.prototype.GetComputedStyle = function(el, pseudoElt) { return this.$val.GetComputedStyle(el, pseudoElt); };
	window.ptr.prototype.GetSelection = function() {
		var w;
		w = this;
		$panic(new $String("not implemented"));
	};
	window.prototype.GetSelection = function() { return this.$val.GetSelection(); };
	window.ptr.prototype.Home = function() {
		var w;
		w = this;
		w.Object.home();
	};
	window.prototype.Home = function() { return this.$val.Home(); };
	window.ptr.prototype.MoveBy = function(dx, dy) {
		var dx, dy, w;
		w = this;
		w.Object.moveBy(dx, dy);
	};
	window.prototype.MoveBy = function(dx, dy) { return this.$val.MoveBy(dx, dy); };
	window.ptr.prototype.MoveTo = function(x, y) {
		var w, x, y;
		w = this;
		w.Object.moveTo(x, y);
	};
	window.prototype.MoveTo = function(x, y) { return this.$val.MoveTo(x, y); };
	window.ptr.prototype.Open = function(url, name, features) {
		var features, name, url, w;
		w = this;
		return new window.ptr(w.Object.open($externalize(url, $String), $externalize(name, $String), $externalize(features, $String)));
	};
	window.prototype.Open = function(url, name, features) { return this.$val.Open(url, name, features); };
	window.ptr.prototype.OpenDialog = function(url, name, features, args) {
		var args, features, name, url, w;
		w = this;
		return new window.ptr(w.Object.openDialog($externalize(url, $String), $externalize(name, $String), $externalize(features, $String), $externalize(args, sliceType)));
	};
	window.prototype.OpenDialog = function(url, name, features, args) { return this.$val.OpenDialog(url, name, features, args); };
	window.ptr.prototype.PostMessage = function(message, target, transfer) {
		var message, target, transfer, w;
		w = this;
		w.Object.postMessage($externalize(message, $String), $externalize(target, $String), $externalize(transfer, sliceType));
	};
	window.prototype.PostMessage = function(message, target, transfer) { return this.$val.PostMessage(message, target, transfer); };
	window.ptr.prototype.Print = function() {
		var w;
		w = this;
		w.Object.print();
	};
	window.prototype.Print = function() { return this.$val.Print(); };
	window.ptr.prototype.Prompt = function(prompt, initial) {
		var initial, prompt, w;
		w = this;
		return $internalize(w.Object.prompt($externalize(prompt, $String), $externalize(initial, $String)), $String);
	};
	window.prototype.Prompt = function(prompt, initial) { return this.$val.Prompt(prompt, initial); };
	window.ptr.prototype.ResizeBy = function(dw, dh) {
		var dh, dw, w;
		w = this;
		w.Object.resizeBy(dw, dh);
	};
	window.prototype.ResizeBy = function(dw, dh) { return this.$val.ResizeBy(dw, dh); };
	window.ptr.prototype.ResizeTo = function(width, height) {
		var height, w, width;
		w = this;
		w.Object.resizeTo(width, height);
	};
	window.prototype.ResizeTo = function(width, height) { return this.$val.ResizeTo(width, height); };
	window.ptr.prototype.Scroll = function(x, y) {
		var w, x, y;
		w = this;
		w.Object.scroll(x, y);
	};
	window.prototype.Scroll = function(x, y) { return this.$val.Scroll(x, y); };
	window.ptr.prototype.ScrollBy = function(dx, dy) {
		var dx, dy, w;
		w = this;
		w.Object.scrollBy(dx, dy);
	};
	window.prototype.ScrollBy = function(dx, dy) { return this.$val.ScrollBy(dx, dy); };
	window.ptr.prototype.ScrollByLines = function(i) {
		var i, w;
		w = this;
		w.Object.scrollByLines(i);
	};
	window.prototype.ScrollByLines = function(i) { return this.$val.ScrollByLines(i); };
	window.ptr.prototype.ScrollTo = function(x, y) {
		var w, x, y;
		w = this;
		w.Object.scrollTo(x, y);
	};
	window.prototype.ScrollTo = function(x, y) { return this.$val.ScrollTo(x, y); };
	window.ptr.prototype.SetCursor = function(name) {
		var name, w;
		w = this;
		w.Object.setCursor($externalize(name, $String));
	};
	window.prototype.SetCursor = function(name) { return this.$val.SetCursor(name); };
	window.ptr.prototype.SetInterval = function(fn, delay) {
		var delay, fn, w;
		w = this;
		return $parseInt(w.Object.setInterval($externalize(fn, funcType), delay)) >> 0;
	};
	window.prototype.SetInterval = function(fn, delay) { return this.$val.SetInterval(fn, delay); };
	window.ptr.prototype.SetTimeout = function(fn, delay) {
		var delay, fn, w;
		w = this;
		return $parseInt(w.Object.setTimeout($externalize(fn, funcType), delay)) >> 0;
	};
	window.prototype.SetTimeout = function(fn, delay) { return this.$val.SetTimeout(fn, delay); };
	window.ptr.prototype.Stop = function() {
		var w;
		w = this;
		w.Object.stop();
	};
	window.prototype.Stop = function() { return this.$val.Stop(); };
	window.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var listener, typ, useCapture, w, wrapper;
		w = this;
		wrapper = (function $b(o) {
			var o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = listener(wrapEvent(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		w.Object.addEventListener($externalize(typ, $String), $externalize(wrapper, funcType$1), $externalize(useCapture, $Bool));
		return wrapper;
	};
	window.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	window.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var listener, typ, useCapture, w;
		w = this;
		w.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType$1), $externalize(useCapture, $Bool));
	};
	window.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	window.ptr.prototype.DispatchEvent = function(event) {
		var event, w;
		w = this;
		return !!(w.Object.dispatchEvent($externalize(event, Event)));
	};
	window.prototype.DispatchEvent = function(event) { return this.$val.DispatchEvent(event); };
	wrapDOMHighResTimeStamp = function(o) {
		var o;
		return (new time.Duration(0, $parseFloat(o) * 1e+06));
	};
	window.ptr.prototype.RequestAnimationFrame = function(callback) {
		var callback, w, wrapper;
		w = this;
		wrapper = (function $b(o) {
			var o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = callback(wrapDOMHighResTimeStamp(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		return $parseInt(w.Object.requestAnimationFrame($externalize(wrapper, funcType$1))) >> 0;
	};
	window.prototype.RequestAnimationFrame = function(callback) { return this.$val.RequestAnimationFrame(callback); };
	window.ptr.prototype.CancelAnimationFrame = function(requestID) {
		var requestID, w;
		w = this;
		w.Object.cancelAnimationFrame(requestID);
	};
	window.prototype.CancelAnimationFrame = function(requestID) { return this.$val.CancelAnimationFrame(requestID); };
	PositionError.ptr.prototype.Error = function() {
		var err;
		err = this;
		return $internalize(err.Object.message(), $String);
	};
	PositionError.prototype.Error = function() { return this.$val.Error(); };
	BasicNode.ptr.prototype.Underlying = function() {
		var n;
		n = this;
		return n.Object;
	};
	BasicNode.prototype.Underlying = function() { return this.$val.Underlying(); };
	BasicNode.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var listener, n, typ, useCapture, wrapper;
		n = this;
		wrapper = (function $b(o) {
			var o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = listener(wrapEvent(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		n.Object.addEventListener($externalize(typ, $String), $externalize(wrapper, funcType$1), $externalize(useCapture, $Bool));
		return wrapper;
	};
	BasicNode.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	BasicNode.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var listener, n, typ, useCapture;
		n = this;
		n.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType$1), $externalize(useCapture, $Bool));
	};
	BasicNode.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	BasicNode.ptr.prototype.DispatchEvent = function(event) {
		var event, n;
		n = this;
		return !!(n.Object.dispatchEvent($externalize(event, Event)));
	};
	BasicNode.prototype.DispatchEvent = function(event) { return this.$val.DispatchEvent(event); };
	BasicNode.ptr.prototype.BaseURI = function() {
		var n;
		n = this;
		return $internalize(n.Object.baseURI, $String);
	};
	BasicNode.prototype.BaseURI = function() { return this.$val.BaseURI(); };
	BasicNode.ptr.prototype.ChildNodes = function() {
		var n;
		n = this;
		return nodeListToNodes(n.Object.childNodes);
	};
	BasicNode.prototype.ChildNodes = function() { return this.$val.ChildNodes(); };
	BasicNode.ptr.prototype.FirstChild = function() {
		var n;
		n = this;
		return wrapNode(n.Object.firstChild);
	};
	BasicNode.prototype.FirstChild = function() { return this.$val.FirstChild(); };
	BasicNode.ptr.prototype.LastChild = function() {
		var n;
		n = this;
		return wrapNode(n.Object.lastChild);
	};
	BasicNode.prototype.LastChild = function() { return this.$val.LastChild(); };
	BasicNode.ptr.prototype.NextSibling = function() {
		var n;
		n = this;
		return wrapNode(n.Object.nextSibling);
	};
	BasicNode.prototype.NextSibling = function() { return this.$val.NextSibling(); };
	BasicNode.ptr.prototype.NodeName = function() {
		var n;
		n = this;
		return $internalize(n.Object.nodeName, $String);
	};
	BasicNode.prototype.NodeName = function() { return this.$val.NodeName(); };
	BasicNode.ptr.prototype.NodeType = function() {
		var n;
		n = this;
		return $parseInt(n.Object.nodeType) >> 0;
	};
	BasicNode.prototype.NodeType = function() { return this.$val.NodeType(); };
	BasicNode.ptr.prototype.NodeValue = function() {
		var n;
		n = this;
		return toString(n.Object.nodeValue);
	};
	BasicNode.prototype.NodeValue = function() { return this.$val.NodeValue(); };
	BasicNode.ptr.prototype.SetNodeValue = function(s) {
		var n, s;
		n = this;
		n.Object.nodeValue = $externalize(s, $String);
	};
	BasicNode.prototype.SetNodeValue = function(s) { return this.$val.SetNodeValue(s); };
	BasicNode.ptr.prototype.OwnerDocument = function() {
		var n;
		n = this;
		$panic(new $String("not implemented"));
	};
	BasicNode.prototype.OwnerDocument = function() { return this.$val.OwnerDocument(); };
	BasicNode.ptr.prototype.ParentNode = function() {
		var n;
		n = this;
		return wrapNode(n.Object.parentNode);
	};
	BasicNode.prototype.ParentNode = function() { return this.$val.ParentNode(); };
	BasicNode.ptr.prototype.ParentElement = function() {
		var n;
		n = this;
		return wrapElement(n.Object.parentElement);
	};
	BasicNode.prototype.ParentElement = function() { return this.$val.ParentElement(); };
	BasicNode.ptr.prototype.PreviousSibling = function() {
		var n;
		n = this;
		return wrapNode(n.Object.previousSibling);
	};
	BasicNode.prototype.PreviousSibling = function() { return this.$val.PreviousSibling(); };
	BasicNode.ptr.prototype.TextContent = function() {
		var n;
		n = this;
		return toString(n.Object.textContent);
	};
	BasicNode.prototype.TextContent = function() { return this.$val.TextContent(); };
	BasicNode.ptr.prototype.SetTextContent = function(s) {
		var n, s;
		n = this;
		n.Object.textContent = $externalize(s, $String);
	};
	BasicNode.prototype.SetTextContent = function(s) { return this.$val.SetTextContent(s); };
	BasicNode.ptr.prototype.AppendChild = function(newchild) {
		var _r, n, newchild, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; newchild = $f.newchild; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = newchild.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n.Object.appendChild(_r);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.AppendChild }; } $f._r = _r; $f.n = n; $f.newchild = newchild; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.AppendChild = function(newchild) { return this.$val.AppendChild(newchild); };
	BasicNode.ptr.prototype.CloneNode = function(deep) {
		var deep, n;
		n = this;
		return wrapNode(n.Object.cloneNode($externalize(deep, $Bool)));
	};
	BasicNode.prototype.CloneNode = function(deep) { return this.$val.CloneNode(deep); };
	BasicNode.ptr.prototype.CompareDocumentPosition = function(other) {
		var _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return $parseInt(n.Object.compareDocumentPosition(_r)) >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.CompareDocumentPosition }; } $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.CompareDocumentPosition = function(other) { return this.$val.CompareDocumentPosition(other); };
	BasicNode.ptr.prototype.Contains = function(other) {
		var _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return !!(n.Object.contains(_r));
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.Contains }; } $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.Contains = function(other) { return this.$val.Contains(other); };
	BasicNode.ptr.prototype.HasChildNodes = function() {
		var n;
		n = this;
		return !!(n.Object.hasChildNodes());
	};
	BasicNode.prototype.HasChildNodes = function() { return this.$val.HasChildNodes(); };
	BasicNode.ptr.prototype.InsertBefore = function(which, before) {
		var _r, _r$1, before, n, o, which, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; before = $f.before; n = $f.n; o = $f.o; which = $f.which; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		o = $ifaceNil;
		/* */ if (!($interfaceIsEqual(before, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(before, $ifaceNil))) { */ case 1:
			_r = before.Underlying(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			o = new $jsObjectPtr(_r);
		/* } */ case 2:
		_r$1 = which.Underlying(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		n.Object.insertBefore(_r$1, $externalize(o, $emptyInterface));
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.InsertBefore }; } $f._r = _r; $f._r$1 = _r$1; $f.before = before; $f.n = n; $f.o = o; $f.which = which; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.InsertBefore = function(which, before) { return this.$val.InsertBefore(which, before); };
	BasicNode.ptr.prototype.IsDefaultNamespace = function(s) {
		var n, s;
		n = this;
		return !!(n.Object.isDefaultNamespace($externalize(s, $String)));
	};
	BasicNode.prototype.IsDefaultNamespace = function(s) { return this.$val.IsDefaultNamespace(s); };
	BasicNode.ptr.prototype.IsEqualNode = function(other) {
		var _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return !!(n.Object.isEqualNode(_r));
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.IsEqualNode }; } $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.IsEqualNode = function(other) { return this.$val.IsEqualNode(other); };
	BasicNode.ptr.prototype.LookupPrefix = function() {
		var n;
		n = this;
		return $internalize(n.Object.lookupPrefix(), $String);
	};
	BasicNode.prototype.LookupPrefix = function() { return this.$val.LookupPrefix(); };
	BasicNode.ptr.prototype.LookupNamespaceURI = function(s) {
		var n, s;
		n = this;
		return toString(n.Object.lookupNamespaceURI($externalize(s, $String)));
	};
	BasicNode.prototype.LookupNamespaceURI = function(s) { return this.$val.LookupNamespaceURI(s); };
	BasicNode.ptr.prototype.Normalize = function() {
		var n;
		n = this;
		n.Object.normalize();
	};
	BasicNode.prototype.Normalize = function() { return this.$val.Normalize(); };
	BasicNode.ptr.prototype.RemoveChild = function(other) {
		var _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n.Object.removeChild(_r);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.RemoveChild }; } $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.RemoveChild = function(other) { return this.$val.RemoveChild(other); };
	BasicNode.ptr.prototype.ReplaceChild = function(newChild, oldChild) {
		var _r, _r$1, n, newChild, oldChild, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; n = $f.n; newChild = $f.newChild; oldChild = $f.oldChild; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = newChild.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = oldChild.Underlying(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		n.Object.replaceChild(_r, _r$1);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.ReplaceChild }; } $f._r = _r; $f._r$1 = _r$1; $f.n = n; $f.newChild = newChild; $f.oldChild = oldChild; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.ReplaceChild = function(newChild, oldChild) { return this.$val.ReplaceChild(newChild, oldChild); };
	BasicHTMLElement.ptr.prototype.AccessKey = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.accessKey, $String);
	};
	BasicHTMLElement.prototype.AccessKey = function() { return this.$val.AccessKey(); };
	BasicHTMLElement.ptr.prototype.Dataset = function() {
		var _i, _key, _ref, data, e, key, keys, o;
		e = this;
		o = e.BasicElement.BasicNode.Object.dataset;
		data = $makeMap($String.keyFor, []);
		keys = js.Keys(o);
		_ref = keys;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			key = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			_key = key; (data || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: $internalize(o[$externalize(key, $String)], $String) };
			_i++;
		}
		return data;
	};
	BasicHTMLElement.prototype.Dataset = function() { return this.$val.Dataset(); };
	BasicHTMLElement.ptr.prototype.SetAccessKey = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.accessKey = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetAccessKey = function(s) { return this.$val.SetAccessKey(s); };
	BasicHTMLElement.ptr.prototype.AccessKeyLabel = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.accessKeyLabel, $String);
	};
	BasicHTMLElement.prototype.AccessKeyLabel = function() { return this.$val.AccessKeyLabel(); };
	BasicHTMLElement.ptr.prototype.SetAccessKeyLabel = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.accessKeyLabel = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetAccessKeyLabel = function(s) { return this.$val.SetAccessKeyLabel(s); };
	BasicHTMLElement.ptr.prototype.ContentEditable = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.contentEditable, $String);
	};
	BasicHTMLElement.prototype.ContentEditable = function() { return this.$val.ContentEditable(); };
	BasicHTMLElement.ptr.prototype.SetContentEditable = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.contentEditable = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetContentEditable = function(s) { return this.$val.SetContentEditable(s); };
	BasicHTMLElement.ptr.prototype.IsContentEditable = function() {
		var e;
		e = this;
		return !!(e.BasicElement.BasicNode.Object.isContentEditable);
	};
	BasicHTMLElement.prototype.IsContentEditable = function() { return this.$val.IsContentEditable(); };
	BasicHTMLElement.ptr.prototype.Dir = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.dir, $String);
	};
	BasicHTMLElement.prototype.Dir = function() { return this.$val.Dir(); };
	BasicHTMLElement.ptr.prototype.SetDir = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.dir = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetDir = function(s) { return this.$val.SetDir(s); };
	BasicHTMLElement.ptr.prototype.Draggable = function() {
		var e;
		e = this;
		return !!(e.BasicElement.BasicNode.Object.draggable);
	};
	BasicHTMLElement.prototype.Draggable = function() { return this.$val.Draggable(); };
	BasicHTMLElement.ptr.prototype.SetDraggable = function(b) {
		var b, e;
		e = this;
		e.BasicElement.BasicNode.Object.draggable = $externalize(b, $Bool);
	};
	BasicHTMLElement.prototype.SetDraggable = function(b) { return this.$val.SetDraggable(b); };
	BasicHTMLElement.ptr.prototype.Lang = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.lang, $String);
	};
	BasicHTMLElement.prototype.Lang = function() { return this.$val.Lang(); };
	BasicHTMLElement.ptr.prototype.SetLang = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.lang = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetLang = function(s) { return this.$val.SetLang(s); };
	BasicHTMLElement.ptr.prototype.OffsetHeight = function() {
		var e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetHeight);
	};
	BasicHTMLElement.prototype.OffsetHeight = function() { return this.$val.OffsetHeight(); };
	BasicHTMLElement.ptr.prototype.OffsetLeft = function() {
		var e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetLeft);
	};
	BasicHTMLElement.prototype.OffsetLeft = function() { return this.$val.OffsetLeft(); };
	BasicHTMLElement.ptr.prototype.OffsetParent = function() {
		var e;
		e = this;
		return wrapHTMLElement(e.BasicElement.BasicNode.Object.offsetParent);
	};
	BasicHTMLElement.prototype.OffsetParent = function() { return this.$val.OffsetParent(); };
	BasicHTMLElement.ptr.prototype.OffsetTop = function() {
		var e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetTop);
	};
	BasicHTMLElement.prototype.OffsetTop = function() { return this.$val.OffsetTop(); };
	BasicHTMLElement.ptr.prototype.OffsetWidth = function() {
		var e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetWidth);
	};
	BasicHTMLElement.prototype.OffsetWidth = function() { return this.$val.OffsetWidth(); };
	BasicHTMLElement.ptr.prototype.Style = function() {
		var e;
		e = this;
		return new CSSStyleDeclaration.ptr(e.BasicElement.BasicNode.Object.style);
	};
	BasicHTMLElement.prototype.Style = function() { return this.$val.Style(); };
	BasicHTMLElement.ptr.prototype.TabIndex = function() {
		var e;
		e = this;
		return $parseInt(e.BasicElement.BasicNode.Object.tabIndex) >> 0;
	};
	BasicHTMLElement.prototype.TabIndex = function() { return this.$val.TabIndex(); };
	BasicHTMLElement.ptr.prototype.SetTabIndex = function(i) {
		var e, i;
		e = this;
		e.BasicElement.BasicNode.Object.tabIndex = i;
	};
	BasicHTMLElement.prototype.SetTabIndex = function(i) { return this.$val.SetTabIndex(i); };
	BasicHTMLElement.ptr.prototype.Title = function() {
		var e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.title, $String);
	};
	BasicHTMLElement.prototype.Title = function() { return this.$val.Title(); };
	BasicHTMLElement.ptr.prototype.SetTitle = function(s) {
		var e, s;
		e = this;
		e.BasicElement.BasicNode.Object.title = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetTitle = function(s) { return this.$val.SetTitle(s); };
	BasicHTMLElement.ptr.prototype.Blur = function() {
		var e;
		e = this;
		e.BasicElement.BasicNode.Object.blur();
	};
	BasicHTMLElement.prototype.Blur = function() { return this.$val.Blur(); };
	BasicHTMLElement.ptr.prototype.Click = function() {
		var e;
		e = this;
		e.BasicElement.BasicNode.Object.click();
	};
	BasicHTMLElement.prototype.Click = function() { return this.$val.Click(); };
	BasicHTMLElement.ptr.prototype.Focus = function() {
		var e;
		e = this;
		e.BasicElement.BasicNode.Object.focus();
	};
	BasicHTMLElement.prototype.Focus = function() { return this.$val.Focus(); };
	BasicElement.ptr.prototype.Attributes = function() {
		var _key, attrs, e, i, item, length, o;
		e = this;
		o = e.BasicNode.Object.attributes;
		attrs = $makeMap($String.keyFor, []);
		length = $parseInt(o.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			item = o.item(i);
			_key = $internalize(item.name, $String); (attrs || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: $internalize(item.value, $String) };
			i = i + (1) >> 0;
		}
		return attrs;
	};
	BasicElement.prototype.Attributes = function() { return this.$val.Attributes(); };
	BasicElement.ptr.prototype.GetBoundingClientRect = function() {
		var e, obj;
		e = this;
		obj = e.BasicNode.Object.getBoundingClientRect();
		return new ClientRect.ptr(obj, 0, 0, 0, 0, 0, 0);
	};
	BasicElement.prototype.GetBoundingClientRect = function() { return this.$val.GetBoundingClientRect(); };
	BasicElement.ptr.prototype.PreviousElementSibling = function() {
		var e;
		e = this;
		return wrapElement(e.BasicNode.Object.previousElementSibling);
	};
	BasicElement.prototype.PreviousElementSibling = function() { return this.$val.PreviousElementSibling(); };
	BasicElement.ptr.prototype.NextElementSibling = function() {
		var e;
		e = this;
		return wrapElement(e.BasicNode.Object.nextElementSibling);
	};
	BasicElement.prototype.NextElementSibling = function() { return this.$val.NextElementSibling(); };
	BasicElement.ptr.prototype.Class = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.BasicNode.Object.classList, e.BasicNode.Object, "className", 0);
	};
	BasicElement.prototype.Class = function() { return this.$val.Class(); };
	BasicElement.ptr.prototype.SetClass = function(s) {
		var e, s;
		e = this;
		e.BasicNode.Object.className = $externalize(s, $String);
	};
	BasicElement.prototype.SetClass = function(s) { return this.$val.SetClass(s); };
	BasicElement.ptr.prototype.Closest = function(s) {
		var e, s;
		e = this;
		return wrapElement(e.BasicNode.Object.closest($externalize(s, $String)));
	};
	BasicElement.prototype.Closest = function(s) { return this.$val.Closest(s); };
	BasicElement.ptr.prototype.ID = function() {
		var e;
		e = this;
		return $internalize(e.BasicNode.Object.id, $String);
	};
	BasicElement.prototype.ID = function() { return this.$val.ID(); };
	BasicElement.ptr.prototype.SetID = function(s) {
		var e, s;
		e = this;
		e.BasicNode.Object.id = $externalize(s, $String);
	};
	BasicElement.prototype.SetID = function(s) { return this.$val.SetID(s); };
	BasicElement.ptr.prototype.TagName = function() {
		var e;
		e = this;
		return $internalize(e.BasicNode.Object.tagName, $String);
	};
	BasicElement.prototype.TagName = function() { return this.$val.TagName(); };
	BasicElement.ptr.prototype.GetAttribute = function(name) {
		var e, name;
		e = this;
		return toString(e.BasicNode.Object.getAttribute($externalize(name, $String)));
	};
	BasicElement.prototype.GetAttribute = function(name) { return this.$val.GetAttribute(name); };
	BasicElement.ptr.prototype.GetAttributeNS = function(ns, name) {
		var e, name, ns;
		e = this;
		return toString(e.BasicNode.Object.getAttributeNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.GetAttributeNS = function(ns, name) { return this.$val.GetAttributeNS(ns, name); };
	BasicElement.ptr.prototype.GetElementsByClassName = function(s) {
		var e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByClassName($externalize(s, $String)));
	};
	BasicElement.prototype.GetElementsByClassName = function(s) { return this.$val.GetElementsByClassName(s); };
	BasicElement.ptr.prototype.GetElementsByTagName = function(s) {
		var e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByTagName($externalize(s, $String)));
	};
	BasicElement.prototype.GetElementsByTagName = function(s) { return this.$val.GetElementsByTagName(s); };
	BasicElement.ptr.prototype.GetElementsByTagNameNS = function(ns, name) {
		var e, name, ns;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByTagNameNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.GetElementsByTagNameNS = function(ns, name) { return this.$val.GetElementsByTagNameNS(ns, name); };
	BasicElement.ptr.prototype.HasAttribute = function(s) {
		var e, s;
		e = this;
		return !!(e.BasicNode.Object.hasAttribute($externalize(s, $String)));
	};
	BasicElement.prototype.HasAttribute = function(s) { return this.$val.HasAttribute(s); };
	BasicElement.ptr.prototype.HasAttributeNS = function(ns, name) {
		var e, name, ns;
		e = this;
		return !!(e.BasicNode.Object.hasAttributeNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.HasAttributeNS = function(ns, name) { return this.$val.HasAttributeNS(ns, name); };
	BasicElement.ptr.prototype.Matches = function(s) {
		var e, s;
		e = this;
		return !!(e.BasicNode.Object.matches($externalize(s, $String)));
	};
	BasicElement.prototype.Matches = function(s) { return this.$val.Matches(s); };
	BasicElement.ptr.prototype.QuerySelector = function(s) {
		var e, s;
		e = this;
		return wrapElement(e.BasicNode.Object.querySelector($externalize(s, $String)));
	};
	BasicElement.prototype.QuerySelector = function(s) { return this.$val.QuerySelector(s); };
	BasicElement.ptr.prototype.QuerySelectorAll = function(s) {
		var e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.querySelectorAll($externalize(s, $String)));
	};
	BasicElement.prototype.QuerySelectorAll = function(s) { return this.$val.QuerySelectorAll(s); };
	BasicElement.ptr.prototype.RemoveAttribute = function(s) {
		var e, s;
		e = this;
		e.BasicNode.Object.removeAttribute($externalize(s, $String));
	};
	BasicElement.prototype.RemoveAttribute = function(s) { return this.$val.RemoveAttribute(s); };
	BasicElement.ptr.prototype.RemoveAttributeNS = function(ns, name) {
		var e, name, ns;
		e = this;
		e.BasicNode.Object.removeAttributeNS($externalize(ns, $String), $externalize(name, $String));
	};
	BasicElement.prototype.RemoveAttributeNS = function(ns, name) { return this.$val.RemoveAttributeNS(ns, name); };
	BasicElement.ptr.prototype.SetAttribute = function(name, value) {
		var e, name, value;
		e = this;
		e.BasicNode.Object.setAttribute($externalize(name, $String), $externalize(value, $String));
	};
	BasicElement.prototype.SetAttribute = function(name, value) { return this.$val.SetAttribute(name, value); };
	BasicElement.ptr.prototype.SetAttributeNS = function(ns, name, value) {
		var e, name, ns, value;
		e = this;
		e.BasicNode.Object.setAttributeNS($externalize(ns, $String), $externalize(name, $String), $externalize(value, $String));
	};
	BasicElement.prototype.SetAttributeNS = function(ns, name, value) { return this.$val.SetAttributeNS(ns, name, value); };
	BasicElement.ptr.prototype.InnerHTML = function() {
		var e;
		e = this;
		return $internalize(e.BasicNode.Object.innerHTML, $String);
	};
	BasicElement.prototype.InnerHTML = function() { return this.$val.InnerHTML(); };
	BasicElement.ptr.prototype.SetInnerHTML = function(s) {
		var e, s;
		e = this;
		e.BasicNode.Object.innerHTML = $externalize(s, $String);
	};
	BasicElement.prototype.SetInnerHTML = function(s) { return this.$val.SetInnerHTML(s); };
	BasicElement.ptr.prototype.OuterHTML = function() {
		var e;
		e = this;
		return $internalize(e.BasicNode.Object.outerHTML, $String);
	};
	BasicElement.prototype.OuterHTML = function() { return this.$val.OuterHTML(); };
	BasicElement.ptr.prototype.SetOuterHTML = function(s) {
		var e, s;
		e = this;
		e.BasicNode.Object.outerHTML = $externalize(s, $String);
	};
	BasicElement.prototype.SetOuterHTML = function(s) { return this.$val.SetOuterHTML(s); };
	HTMLAnchorElement.ptr.prototype.Rel = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.URLUtils.Object.relList, e.URLUtils.Object, "rel", 0);
	};
	HTMLAnchorElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLAppletElement.ptr.prototype.Rel = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.relList, e.BasicHTMLElement.BasicElement.BasicNode.Object, "rel", 0);
	};
	HTMLAppletElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLAreaElement.ptr.prototype.Rel = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.URLUtils.Object.relList, e.URLUtils.Object, "rel", 0);
	};
	HTMLAreaElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLBaseElement.ptr.prototype.Href = function() {
		var e;
		e = this;
		return $internalize(e.BasicHTMLElement.BasicElement.BasicNode.Object.href, $String);
	};
	HTMLBaseElement.prototype.Href = function() { return this.$val.Href(); };
	HTMLBaseElement.ptr.prototype.Target = function() {
		var e;
		e = this;
		return $internalize(e.BasicHTMLElement.BasicElement.BasicNode.Object.target, $String);
	};
	HTMLBaseElement.prototype.Target = function() { return this.$val.Target(); };
	HTMLButtonElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLButtonElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLButtonElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLButtonElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLButtonElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLButtonElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLButtonElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLButtonElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLButtonElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLButtonElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	ImageData.ptr.prototype.ColorModel = function() {
		var m;
		m = this;
		return color.NRGBAModel;
	};
	ImageData.prototype.ColorModel = function() { return this.$val.ColorModel(); };
	ImageData.ptr.prototype.Bounds = function() {
		var m;
		m = this;
		return image.Rect(0, 0, $parseInt(m.Object.width) >> 0, $parseInt(m.Object.height) >> 0);
	};
	ImageData.prototype.Bounds = function() { return this.$val.Bounds(); };
	ImageData.ptr.prototype.At = function(x, y) {
		var m, x, x$1, y;
		m = this;
		return (x$1 = m.NRGBAAt(x, y), new x$1.constructor.elem(x$1));
	};
	ImageData.prototype.At = function(x, y) { return this.$val.At(x, y); };
	ImageData.ptr.prototype.NRGBAAt = function(x, y) {
		var i, m, x, y;
		m = this;
		if (x < 0 || x >= ($parseInt(m.Object.width) >> 0) || y < 0 || y >= ($parseInt(m.Object.height) >> 0)) {
			return new color.NRGBA.ptr(0, 0, 0, 0);
		}
		i = $imul(((($imul(y, ($parseInt(m.Object.width) >> 0))) + x >> 0)), 4);
		return new color.NRGBA.ptr(((($parseInt(m.Object.data[(i + 0 >> 0)]) >> 0) << 24 >>> 24)), ((($parseInt(m.Object.data[(i + 1 >> 0)]) >> 0) << 24 >>> 24)), ((($parseInt(m.Object.data[(i + 2 >> 0)]) >> 0) << 24 >>> 24)), ((($parseInt(m.Object.data[(i + 3 >> 0)]) >> 0) << 24 >>> 24)));
	};
	ImageData.prototype.NRGBAAt = function(x, y) { return this.$val.NRGBAAt(x, y); };
	ImageData.ptr.prototype.Set = function(x, y, c) {
		var _r, c, c1, i, m, x, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; c = $f.c; c1 = $f.c1; i = $f.i; m = $f.m; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (x < 0 || x >= ($parseInt(m.Object.width) >> 0) || y < 0 || y >= ($parseInt(m.Object.height) >> 0)) {
			$s = -1; return;
		}
		_r = color.NRGBAModel.Convert(c); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		c1 = $clone($assertType(_r, color.NRGBA), color.NRGBA);
		i = $imul(((($imul(y, ($parseInt(m.Object.width) >> 0))) + x >> 0)), 4);
		m.Object.data[(i + 0 >> 0)] = c1.R;
		m.Object.data[(i + 1 >> 0)] = c1.G;
		m.Object.data[(i + 2 >> 0)] = c1.B;
		m.Object.data[(i + 3 >> 0)] = c1.A;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ImageData.ptr.prototype.Set }; } $f._r = _r; $f.c = c; $f.c1 = c1; $f.i = i; $f.m = m; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	ImageData.prototype.Set = function(x, y, c) { return this.$val.Set(x, y, c); };
	ImageData.ptr.prototype.SetNRGBA = function(x, y, c) {
		var c, i, m, x, y;
		m = this;
		if (x < 0 || x >= ($parseInt(m.Object.width) >> 0) || y < 0 || y >= ($parseInt(m.Object.height) >> 0)) {
			return;
		}
		i = $imul(((($imul(y, ($parseInt(m.Object.width) >> 0))) + x >> 0)), 4);
		m.Object.data[(i + 0 >> 0)] = c.R;
		m.Object.data[(i + 1 >> 0)] = c.G;
		m.Object.data[(i + 2 >> 0)] = c.B;
		m.Object.data[(i + 3 >> 0)] = c.A;
	};
	ImageData.prototype.SetNRGBA = function(x, y, c) { return this.$val.SetNRGBA(x, y, c); };
	CanvasGradient.ptr.prototype.AddColorStop = function(offset, color$1) {
		var cg, color$1, offset;
		cg = this;
		cg.Object.addColorStop(offset, $externalize(color$1, $String));
	};
	CanvasGradient.prototype.AddColorStop = function(offset, color$1) { return this.$val.AddColorStop(offset, color$1); };
	HTMLCanvasElement.ptr.prototype.GetContext2d = function() {
		var ctx, e;
		e = this;
		ctx = e.GetContext("2d");
		return new CanvasRenderingContext2D.ptr(ctx, "", "", "", 0, 0, 0, "", "", 0, 0, "", "", "", 0, "");
	};
	HTMLCanvasElement.prototype.GetContext2d = function() { return this.$val.GetContext2d(); };
	HTMLCanvasElement.ptr.prototype.GetContext = function(param) {
		var e, param;
		e = this;
		return e.BasicHTMLElement.BasicElement.BasicNode.Object.getContext($externalize(param, $String));
	};
	HTMLCanvasElement.prototype.GetContext = function(param) { return this.$val.GetContext(param); };
	CanvasRenderingContext2D.ptr.prototype.ClearRect = function(x, y, width, height) {
		var ctx, height, width, x, y;
		ctx = this;
		ctx.Object.clearRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.ClearRect = function(x, y, width, height) { return this.$val.ClearRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.FillRect = function(x, y, width, height) {
		var ctx, height, width, x, y;
		ctx = this;
		ctx.Object.fillRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.FillRect = function(x, y, width, height) { return this.$val.FillRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.StrokeRect = function(x, y, width, height) {
		var ctx, height, width, x, y;
		ctx = this;
		ctx.Object.strokeRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.StrokeRect = function(x, y, width, height) { return this.$val.StrokeRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.FillText = function(text, x, y, maxWidth) {
		var ctx, maxWidth, text, x, y;
		ctx = this;
		if (maxWidth === -1) {
			ctx.Object.fillText($externalize(text, $String), x, y);
			return;
		}
		ctx.Object.fillText($externalize(text, $String), x, y, maxWidth);
	};
	CanvasRenderingContext2D.prototype.FillText = function(text, x, y, maxWidth) { return this.$val.FillText(text, x, y, maxWidth); };
	CanvasRenderingContext2D.ptr.prototype.StrokeText = function(text, x, y, maxWidth) {
		var ctx, maxWidth, text, x, y;
		ctx = this;
		if (maxWidth === -1) {
			ctx.Object.strokeText($externalize(text, $String), x, y);
			return;
		}
		ctx.Object.strokeText($externalize(text, $String), x, y, maxWidth);
	};
	CanvasRenderingContext2D.prototype.StrokeText = function(text, x, y, maxWidth) { return this.$val.StrokeText(text, x, y, maxWidth); };
	CanvasRenderingContext2D.ptr.prototype.MeasureText = function(text) {
		var ctx, text, textMetrics;
		ctx = this;
		textMetrics = ctx.Object.measureText($externalize(text, $String));
		return new TextMetrics.ptr(textMetrics, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	};
	CanvasRenderingContext2D.prototype.MeasureText = function(text) { return this.$val.MeasureText(text); };
	CanvasRenderingContext2D.ptr.prototype.GetLineDash = function() {
		var _i, _ref, ctx, dash, dashes;
		ctx = this;
		dashes = sliceType$12.nil;
		_ref = $assertType($internalize(ctx.Object.getLineDash(), $emptyInterface), sliceType);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			dash = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			dashes = $append(dashes, $assertType(dash, $Float64));
			_i++;
		}
		return dashes;
	};
	CanvasRenderingContext2D.prototype.GetLineDash = function() { return this.$val.GetLineDash(); };
	CanvasRenderingContext2D.ptr.prototype.SetLineDash = function(dashes) {
		var ctx, dashes;
		ctx = this;
		ctx.Object.setLineDash($externalize(dashes, sliceType$12));
	};
	CanvasRenderingContext2D.prototype.SetLineDash = function(dashes) { return this.$val.SetLineDash(dashes); };
	CanvasRenderingContext2D.ptr.prototype.CreateLinearGradient = function(x0, y0, x1, y1) {
		var ctx, x0, x1, y0, y1;
		ctx = this;
		return new CanvasGradient.ptr(ctx.Object.createLinearGradient(x0, y0, x1, y1));
	};
	CanvasRenderingContext2D.prototype.CreateLinearGradient = function(x0, y0, x1, y1) { return this.$val.CreateLinearGradient(x0, y0, x1, y1); };
	CanvasRenderingContext2D.ptr.prototype.CreateRadialGradient = function(x0, y0, r0, x1, y1, r1) {
		var ctx, r0, r1, x0, x1, y0, y1;
		ctx = this;
		return new CanvasGradient.ptr(ctx.Object.createRadialGradient(x0, y0, r0, x1, y1, r1));
	};
	CanvasRenderingContext2D.prototype.CreateRadialGradient = function(x0, y0, r0, x1, y1, r1) { return this.$val.CreateRadialGradient(x0, y0, r0, x1, y1, r1); };
	CanvasRenderingContext2D.ptr.prototype.CreatePattern = function(image$1, repetition) {
		var ctx, image$1, repetition;
		ctx = this;
		return new CanvasPattern.ptr(ctx.Object.createPattern($externalize(image$1, Element), $externalize(repetition, $String)));
	};
	CanvasRenderingContext2D.prototype.CreatePattern = function(image$1, repetition) { return this.$val.CreatePattern(image$1, repetition); };
	CanvasRenderingContext2D.ptr.prototype.BeginPath = function() {
		var ctx;
		ctx = this;
		ctx.Object.beginPath();
	};
	CanvasRenderingContext2D.prototype.BeginPath = function() { return this.$val.BeginPath(); };
	CanvasRenderingContext2D.ptr.prototype.ClosePath = function() {
		var ctx;
		ctx = this;
		ctx.Object.closePath();
	};
	CanvasRenderingContext2D.prototype.ClosePath = function() { return this.$val.ClosePath(); };
	CanvasRenderingContext2D.ptr.prototype.MoveTo = function(x, y) {
		var ctx, x, y;
		ctx = this;
		ctx.Object.moveTo(x, y);
	};
	CanvasRenderingContext2D.prototype.MoveTo = function(x, y) { return this.$val.MoveTo(x, y); };
	CanvasRenderingContext2D.ptr.prototype.LineTo = function(x, y) {
		var ctx, x, y;
		ctx = this;
		ctx.Object.lineTo(x, y);
	};
	CanvasRenderingContext2D.prototype.LineTo = function(x, y) { return this.$val.LineTo(x, y); };
	CanvasRenderingContext2D.ptr.prototype.BezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
		var cp1x, cp1y, cp2x, cp2y, ctx, x, y;
		ctx = this;
		ctx.Object.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
	};
	CanvasRenderingContext2D.prototype.BezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) { return this.$val.BezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y); };
	CanvasRenderingContext2D.ptr.prototype.QuadraticCurveTo = function(cpx, cpy, x, y) {
		var cpx, cpy, ctx, x, y;
		ctx = this;
		ctx.Object.quadraticCurveTo(cpx, cpy, x, y);
	};
	CanvasRenderingContext2D.prototype.QuadraticCurveTo = function(cpx, cpy, x, y) { return this.$val.QuadraticCurveTo(cpx, cpy, x, y); };
	CanvasRenderingContext2D.ptr.prototype.Arc = function(x, y, r, sAngle, eAngle, counterclockwise) {
		var counterclockwise, ctx, eAngle, r, sAngle, x, y;
		ctx = this;
		ctx.Object.arc(x, y, r, sAngle, eAngle, $externalize(counterclockwise, $Bool));
	};
	CanvasRenderingContext2D.prototype.Arc = function(x, y, r, sAngle, eAngle, counterclockwise) { return this.$val.Arc(x, y, r, sAngle, eAngle, counterclockwise); };
	CanvasRenderingContext2D.ptr.prototype.ArcTo = function(x1, y1, x2, y2, r) {
		var ctx, r, x1, x2, y1, y2;
		ctx = this;
		ctx.Object.arcTo(x1, y1, x2, y2, r);
	};
	CanvasRenderingContext2D.prototype.ArcTo = function(x1, y1, x2, y2, r) { return this.$val.ArcTo(x1, y1, x2, y2, r); };
	CanvasRenderingContext2D.ptr.prototype.Ellipse = function(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise) {
		var anticlockwise, ctx, endAngle, radiusX, radiusY, rotation, startAngle, x, y;
		ctx = this;
		ctx.Object.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, $externalize(anticlockwise, $Bool));
	};
	CanvasRenderingContext2D.prototype.Ellipse = function(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise) { return this.$val.Ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise); };
	CanvasRenderingContext2D.ptr.prototype.Rect = function(x, y, width, height) {
		var ctx, height, width, x, y;
		ctx = this;
		ctx.Object.rect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.Rect = function(x, y, width, height) { return this.$val.Rect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.Fill = function() {
		var ctx;
		ctx = this;
		ctx.Object.fill();
	};
	CanvasRenderingContext2D.prototype.Fill = function() { return this.$val.Fill(); };
	CanvasRenderingContext2D.ptr.prototype.Stroke = function() {
		var ctx;
		ctx = this;
		ctx.Object.stroke();
	};
	CanvasRenderingContext2D.prototype.Stroke = function() { return this.$val.Stroke(); };
	CanvasRenderingContext2D.ptr.prototype.DrawFocusIfNeeded = function(element, path) {
		var ctx, element, path;
		ctx = this;
		ctx.Object.drawFocusIfNeeded($externalize(element, HTMLElement), path);
	};
	CanvasRenderingContext2D.prototype.DrawFocusIfNeeded = function(element, path) { return this.$val.DrawFocusIfNeeded(element, path); };
	CanvasRenderingContext2D.ptr.prototype.ScrollPathIntoView = function(path) {
		var ctx, path;
		ctx = this;
		ctx.Object.scrollPathIntoView(path);
	};
	CanvasRenderingContext2D.prototype.ScrollPathIntoView = function(path) { return this.$val.ScrollPathIntoView(path); };
	CanvasRenderingContext2D.ptr.prototype.Clip = function() {
		var ctx;
		ctx = this;
		ctx.Object.clip();
	};
	CanvasRenderingContext2D.prototype.Clip = function() { return this.$val.Clip(); };
	CanvasRenderingContext2D.ptr.prototype.IsPointInPath = function(x, y) {
		var ctx, x, y;
		ctx = this;
		return !!(ctx.Object.isPointInPath(x, y));
	};
	CanvasRenderingContext2D.prototype.IsPointInPath = function(x, y) { return this.$val.IsPointInPath(x, y); };
	CanvasRenderingContext2D.ptr.prototype.IsPointInStroke = function(path, x, y) {
		var ctx, path, x, y;
		ctx = this;
		return !!(ctx.Object.isPointInStroke(path, x, y));
	};
	CanvasRenderingContext2D.prototype.IsPointInStroke = function(path, x, y) { return this.$val.IsPointInStroke(path, x, y); };
	CanvasRenderingContext2D.ptr.prototype.Rotate = function(angle) {
		var angle, ctx;
		ctx = this;
		ctx.Object.rotate(angle);
	};
	CanvasRenderingContext2D.prototype.Rotate = function(angle) { return this.$val.Rotate(angle); };
	CanvasRenderingContext2D.ptr.prototype.Scale = function(scaleWidth, scaleHeight) {
		var ctx, scaleHeight, scaleWidth;
		ctx = this;
		ctx.Object.scale(scaleWidth, scaleHeight);
	};
	CanvasRenderingContext2D.prototype.Scale = function(scaleWidth, scaleHeight) { return this.$val.Scale(scaleWidth, scaleHeight); };
	CanvasRenderingContext2D.ptr.prototype.Translate = function(x, y) {
		var ctx, x, y;
		ctx = this;
		ctx.Object.translate(x, y);
	};
	CanvasRenderingContext2D.prototype.Translate = function(x, y) { return this.$val.Translate(x, y); };
	CanvasRenderingContext2D.ptr.prototype.Transform = function(a, b, c, d, e, f) {
		var a, b, c, ctx, d, e, f;
		ctx = this;
		ctx.Object.transform(a, b, c, d, e, f);
	};
	CanvasRenderingContext2D.prototype.Transform = function(a, b, c, d, e, f) { return this.$val.Transform(a, b, c, d, e, f); };
	CanvasRenderingContext2D.ptr.prototype.SetTransform = function(a, b, c, d, e, f) {
		var a, b, c, ctx, d, e, f;
		ctx = this;
		ctx.Object.setTransform(a, b, c, d, e, f);
	};
	CanvasRenderingContext2D.prototype.SetTransform = function(a, b, c, d, e, f) { return this.$val.SetTransform(a, b, c, d, e, f); };
	CanvasRenderingContext2D.ptr.prototype.ResetTransform = function() {
		var ctx;
		ctx = this;
		ctx.Object.resetTransform();
	};
	CanvasRenderingContext2D.prototype.ResetTransform = function() { return this.$val.ResetTransform(); };
	CanvasRenderingContext2D.ptr.prototype.DrawImage = function(image$1, dx, dy) {
		var ctx, dx, dy, image$1;
		ctx = this;
		ctx.Object.drawImage($externalize(image$1, Element), dx, dy);
	};
	CanvasRenderingContext2D.prototype.DrawImage = function(image$1, dx, dy) { return this.$val.DrawImage(image$1, dx, dy); };
	CanvasRenderingContext2D.ptr.prototype.DrawImageWithDst = function(image$1, dx, dy, dWidth, dHeight) {
		var ctx, dHeight, dWidth, dx, dy, image$1;
		ctx = this;
		ctx.Object.drawImage($externalize(image$1, Element), dx, dy, dWidth, dHeight);
	};
	CanvasRenderingContext2D.prototype.DrawImageWithDst = function(image$1, dx, dy, dWidth, dHeight) { return this.$val.DrawImageWithDst(image$1, dx, dy, dWidth, dHeight); };
	CanvasRenderingContext2D.ptr.prototype.DrawImageWithSrcAndDst = function(image$1, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) {
		var ctx, dHeight, dWidth, dx, dy, image$1, sHeight, sWidth, sx, sy;
		ctx = this;
		ctx.Object.drawImage($externalize(image$1, Element), sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
	};
	CanvasRenderingContext2D.prototype.DrawImageWithSrcAndDst = function(image$1, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) { return this.$val.DrawImageWithSrcAndDst(image$1, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight); };
	CanvasRenderingContext2D.ptr.prototype.CreateImageData = function(width, height) {
		var ctx, height, width;
		ctx = this;
		return new ImageData.ptr(ctx.Object.createImageData(width, height), 0, 0, null);
	};
	CanvasRenderingContext2D.prototype.CreateImageData = function(width, height) { return this.$val.CreateImageData(width, height); };
	CanvasRenderingContext2D.ptr.prototype.GetImageData = function(sx, sy, sw, sh) {
		var ctx, sh, sw, sx, sy;
		ctx = this;
		return new ImageData.ptr(ctx.Object.getImageData(sx, sy, sw, sh), 0, 0, null);
	};
	CanvasRenderingContext2D.prototype.GetImageData = function(sx, sy, sw, sh) { return this.$val.GetImageData(sx, sy, sw, sh); };
	CanvasRenderingContext2D.ptr.prototype.PutImageData = function(imageData, dx, dy) {
		var ctx, dx, dy, imageData;
		ctx = this;
		ctx.Object.putImageData($externalize(imageData, ptrType$13), dx, dy);
	};
	CanvasRenderingContext2D.prototype.PutImageData = function(imageData, dx, dy) { return this.$val.PutImageData(imageData, dx, dy); };
	CanvasRenderingContext2D.ptr.prototype.PutImageDataDirty = function(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
		var ctx, dirtyHeight, dirtyWidth, dirtyX, dirtyY, dx, dy, imageData;
		ctx = this;
		ctx.Object.putImageData($externalize(imageData, ptrType$13), dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
	};
	CanvasRenderingContext2D.prototype.PutImageDataDirty = function(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) { return this.$val.PutImageDataDirty(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight); };
	CanvasRenderingContext2D.ptr.prototype.Save = function() {
		var ctx;
		ctx = this;
		ctx.Object.save();
	};
	CanvasRenderingContext2D.prototype.Save = function() { return this.$val.Save(); };
	CanvasRenderingContext2D.ptr.prototype.Restore = function() {
		var ctx;
		ctx = this;
		ctx.Object.restore();
	};
	CanvasRenderingContext2D.prototype.Restore = function() { return this.$val.Restore(); };
	HTMLDataListElement.ptr.prototype.Options = function() {
		var e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "options");
	};
	HTMLDataListElement.prototype.Options = function() { return this.$val.Options(); };
	HTMLFieldSetElement.ptr.prototype.Elements = function() {
		var e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.elements);
	};
	HTMLFieldSetElement.prototype.Elements = function() { return this.$val.Elements(); };
	HTMLFieldSetElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLFieldSetElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLFieldSetElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLFieldSetElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLFieldSetElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLFieldSetElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLFieldSetElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLFieldSetElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLFormElement.ptr.prototype.Elements = function() {
		var e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.elements);
	};
	HTMLFormElement.prototype.Elements = function() { return this.$val.Elements(); };
	HTMLFormElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLFormElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLFormElement.ptr.prototype.Submit = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.submit();
	};
	HTMLFormElement.prototype.Submit = function() { return this.$val.Submit(); };
	HTMLFormElement.ptr.prototype.Reset = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.reset();
	};
	HTMLFormElement.prototype.Reset = function() { return this.$val.Reset(); };
	HTMLFormElement.ptr.prototype.Item = function(index) {
		var e, index;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.item(index));
	};
	HTMLFormElement.prototype.Item = function(index) { return this.$val.Item(index); };
	HTMLFormElement.ptr.prototype.NamedItem = function(name) {
		var e, name;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.namedItem($externalize(name, $String)));
	};
	HTMLFormElement.prototype.NamedItem = function(name) { return this.$val.NamedItem(name); };
	HTMLIFrameElement.ptr.prototype.ContentDocument = function() {
		var e;
		e = this;
		return wrapDocument(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentDocument);
	};
	HTMLIFrameElement.prototype.ContentDocument = function() { return this.$val.ContentDocument(); };
	HTMLIFrameElement.ptr.prototype.ContentWindow = function() {
		var e;
		e = this;
		return new window.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentWindow);
	};
	HTMLIFrameElement.prototype.ContentWindow = function() { return this.$val.ContentWindow(); };
	HTMLInputElement.ptr.prototype.Files = function() {
		var _i, _ref, e, files, i, out;
		e = this;
		files = e.BasicHTMLElement.BasicElement.BasicNode.Object.files;
		out = $makeSlice(sliceType$13, ($parseInt(files.length) >> 0));
		_ref = out;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = new File.ptr(files.item(i)));
			_i++;
		}
		return out;
	};
	HTMLInputElement.prototype.Files = function() { return this.$val.Files(); };
	HTMLInputElement.ptr.prototype.List = function() {
		var e, list;
		e = this;
		list = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.list);
		if ($interfaceIsEqual(list, $ifaceNil)) {
			return ptrType$15.nil;
		}
		return $assertType(list, ptrType$15);
	};
	HTMLInputElement.prototype.List = function() { return this.$val.List(); };
	HTMLInputElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLInputElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLInputElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLInputElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLInputElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLInputElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLInputElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLInputElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLInputElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLInputElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLInputElement.ptr.prototype.Select = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.select();
	};
	HTMLInputElement.prototype.Select = function() { return this.$val.Select(); };
	HTMLInputElement.ptr.prototype.SetSelectionRange = function(start, end, direction) {
		var direction, e, end, start;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setSelectionRange(start, end, $externalize(direction, $String));
	};
	HTMLInputElement.prototype.SetSelectionRange = function(start, end, direction) { return this.$val.SetSelectionRange(start, end, direction); };
	HTMLInputElement.ptr.prototype.StepDown = function(n) {
		var e, n;
		e = this;
		return callRecover(e.BasicHTMLElement.BasicElement.BasicNode.Object, "stepDown", new sliceType([new $Int(n)]));
	};
	HTMLInputElement.prototype.StepDown = function(n) { return this.$val.StepDown(n); };
	HTMLInputElement.ptr.prototype.StepUp = function(n) {
		var e, n;
		e = this;
		return callRecover(e.BasicHTMLElement.BasicElement.BasicNode.Object, "stepUp", new sliceType([new $Int(n)]));
	};
	HTMLInputElement.prototype.StepUp = function(n) { return this.$val.StepUp(n); };
	HTMLKeygenElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLKeygenElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLKeygenElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLKeygenElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLKeygenElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLKeygenElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLKeygenElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLKeygenElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLKeygenElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLKeygenElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLLabelElement.ptr.prototype.Control = function() {
		var e;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.control);
	};
	HTMLLabelElement.prototype.Control = function() { return this.$val.Control(); };
	HTMLLabelElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLLabelElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLLegendElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLLegendElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLLinkElement.ptr.prototype.Rel = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.relList, e.BasicHTMLElement.BasicElement.BasicNode.Object, "rel", 0);
	};
	HTMLLinkElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLLinkElement.ptr.prototype.Sizes = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.sizes, e.BasicHTMLElement.BasicElement.BasicNode.Object, "", 0);
	};
	HTMLLinkElement.prototype.Sizes = function() { return this.$val.Sizes(); };
	HTMLLinkElement.ptr.prototype.Sheet = function() {
		var e;
		e = this;
		$panic(new $String("not implemented"));
	};
	HTMLLinkElement.prototype.Sheet = function() { return this.$val.Sheet(); };
	HTMLMapElement.ptr.prototype.Areas = function() {
		var _i, _ref, area, areas, e, i, out;
		e = this;
		areas = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.areas);
		out = $makeSlice(sliceType$14, areas.$length);
		_ref = areas;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			area = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = $assertType(area, ptrType$16));
			_i++;
		}
		return out;
	};
	HTMLMapElement.prototype.Areas = function() { return this.$val.Areas(); };
	HTMLMapElement.ptr.prototype.Images = function() {
		var e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.areas);
	};
	HTMLMapElement.prototype.Images = function() { return this.$val.Images(); };
	HTMLMediaElement.ptr.prototype.Play = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.play();
	};
	HTMLMediaElement.prototype.Play = function() { return this.$val.Play(); };
	HTMLMediaElement.ptr.prototype.Pause = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.pause();
	};
	HTMLMediaElement.prototype.Pause = function() { return this.$val.Pause(); };
	HTMLMeterElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLMeterElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLObjectElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLObjectElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLObjectElement.ptr.prototype.ContentDocument = function() {
		var e;
		e = this;
		return wrapDocument(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentDocument);
	};
	HTMLObjectElement.prototype.ContentDocument = function() { return this.$val.ContentDocument(); };
	HTMLObjectElement.ptr.prototype.ContentWindow = function() {
		var e;
		e = this;
		return new window.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentWindow);
	};
	HTMLObjectElement.prototype.ContentWindow = function() { return this.$val.ContentWindow(); };
	HTMLObjectElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLObjectElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLObjectElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLObjectElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLObjectElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLObjectElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLOptionElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOptionElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLOutputElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOutputElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLOutputElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOutputElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLOutputElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLOutputElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLOutputElement.ptr.prototype.For = function() {
		var e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.htmlFor, e.BasicHTMLElement.BasicElement.BasicNode.Object, "", 0);
	};
	HTMLOutputElement.prototype.For = function() { return this.$val.For(); };
	HTMLOutputElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLOutputElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLOutputElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLOutputElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLProgressElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLProgressElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLSelectElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLSelectElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLSelectElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLSelectElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLSelectElement.ptr.prototype.Options = function() {
		var e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "options");
	};
	HTMLSelectElement.prototype.Options = function() { return this.$val.Options(); };
	HTMLSelectElement.ptr.prototype.SelectedOptions = function() {
		var e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "selectedOptions");
	};
	HTMLSelectElement.prototype.SelectedOptions = function() { return this.$val.SelectedOptions(); };
	HTMLSelectElement.ptr.prototype.Item = function(index) {
		var e, el, index;
		e = this;
		el = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.item(index));
		if ($interfaceIsEqual(el, $ifaceNil)) {
			return ptrType$7.nil;
		}
		return $assertType(el, ptrType$7);
	};
	HTMLSelectElement.prototype.Item = function(index) { return this.$val.Item(index); };
	HTMLSelectElement.ptr.prototype.NamedItem = function(name) {
		var e, el, name;
		e = this;
		el = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.namedItem($externalize(name, $String)));
		if ($interfaceIsEqual(el, $ifaceNil)) {
			return ptrType$7.nil;
		}
		return $assertType(el, ptrType$7);
	};
	HTMLSelectElement.prototype.NamedItem = function(name) { return this.$val.NamedItem(name); };
	HTMLSelectElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLSelectElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLSelectElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLSelectElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLSelectElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLSelectElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLTableRowElement.ptr.prototype.Cells = function() {
		var _i, _ref, cell, cells, e, i, out;
		e = this;
		cells = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.cells);
		out = $makeSlice(sliceType$15, cells.$length);
		_ref = cells;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			cell = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = $assertType(cell, ptrType$17));
			_i++;
		}
		return out;
	};
	HTMLTableRowElement.prototype.Cells = function() { return this.$val.Cells(); };
	HTMLTableRowElement.ptr.prototype.InsertCell = function(index) {
		var e, index;
		e = this;
		return $assertType(wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.insertCell(index)), ptrType$17);
	};
	HTMLTableRowElement.prototype.InsertCell = function(index) { return this.$val.InsertCell(index); };
	HTMLTableRowElement.ptr.prototype.DeleteCell = function(index) {
		var e, index;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.deleteCell(index);
	};
	HTMLTableRowElement.prototype.DeleteCell = function(index) { return this.$val.DeleteCell(index); };
	HTMLTableSectionElement.ptr.prototype.Rows = function() {
		var _i, _ref, e, i, out, row, rows;
		e = this;
		rows = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.rows);
		out = $makeSlice(sliceType$16, rows.$length);
		_ref = rows;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			row = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = $assertType(row, ptrType$18));
			_i++;
		}
		return out;
	};
	HTMLTableSectionElement.prototype.Rows = function() { return this.$val.Rows(); };
	HTMLTableSectionElement.ptr.prototype.DeleteRow = function(index) {
		var e, index;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.deleteRow(index);
	};
	HTMLTableSectionElement.prototype.DeleteRow = function(index) { return this.$val.DeleteRow(index); };
	HTMLTableSectionElement.ptr.prototype.InsertRow = function(index) {
		var e, index;
		e = this;
		return $assertType(wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.insertRow(index)), ptrType$18);
	};
	HTMLTableSectionElement.prototype.InsertRow = function(index) { return this.$val.InsertRow(index); };
	HTMLTemplateElement.ptr.prototype.Content = function() {
		var e;
		e = this;
		return wrapDocumentFragment(e.BasicHTMLElement.BasicElement.BasicNode.Object.content);
	};
	HTMLTemplateElement.prototype.Content = function() { return this.$val.Content(); };
	HTMLTextAreaElement.ptr.prototype.Form = function() {
		var e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLTextAreaElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLTextAreaElement.ptr.prototype.Labels = function() {
		var e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLTextAreaElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLTextAreaElement.ptr.prototype.Validity = function() {
		var e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLTextAreaElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLTextAreaElement.ptr.prototype.CheckValidity = function() {
		var e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLTextAreaElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLTextAreaElement.ptr.prototype.SetCustomValidity = function(s) {
		var e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLTextAreaElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLTextAreaElement.ptr.prototype.Select = function() {
		var e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.select();
	};
	HTMLTextAreaElement.prototype.Select = function() { return this.$val.Select(); };
	HTMLTextAreaElement.ptr.prototype.SetSelectionRange = function(start, end, direction) {
		var direction, e, end, start;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setSelectionRange(start, end, $externalize(direction, $String));
	};
	HTMLTextAreaElement.prototype.SetSelectionRange = function(start, end, direction) { return this.$val.SetSelectionRange(start, end, direction); };
	HTMLTrackElement.ptr.prototype.Track = function() {
		var e;
		e = this;
		return new TextTrack.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.track);
	};
	HTMLTrackElement.prototype.Track = function() { return this.$val.Track(); };
	CSSStyleDeclaration.ptr.prototype.ToMap = function() {
		var N, _key, css, i, m, name, value;
		css = this;
		m = {};
		N = $parseInt(css.Object.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < N)) { break; }
			name = $internalize(css.Object.item(i), $String);
			value = $internalize(css.Object.getPropertyValue($externalize(name, $String)), $String);
			_key = name; (m || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: value };
			i = i + (1) >> 0;
		}
		return m;
	};
	CSSStyleDeclaration.prototype.ToMap = function() { return this.$val.ToMap(); };
	CSSStyleDeclaration.ptr.prototype.RemoveProperty = function(name) {
		var css, name;
		css = this;
		css.Object.removeProperty($externalize(name, $String));
	};
	CSSStyleDeclaration.prototype.RemoveProperty = function(name) { return this.$val.RemoveProperty(name); };
	CSSStyleDeclaration.ptr.prototype.GetPropertyValue = function(name) {
		var css, name;
		css = this;
		return toString(css.Object.getPropertyValue($externalize(name, $String)));
	};
	CSSStyleDeclaration.prototype.GetPropertyValue = function(name) { return this.$val.GetPropertyValue(name); };
	CSSStyleDeclaration.ptr.prototype.GetPropertyPriority = function(name) {
		var css, name;
		css = this;
		return toString(css.Object.getPropertyPriority($externalize(name, $String)));
	};
	CSSStyleDeclaration.prototype.GetPropertyPriority = function(name) { return this.$val.GetPropertyPriority(name); };
	CSSStyleDeclaration.ptr.prototype.SetProperty = function(name, value, priority) {
		var css, name, priority, value;
		css = this;
		css.Object.setProperty($externalize(name, $String), $externalize(value, $String), $externalize(priority, $String));
	};
	CSSStyleDeclaration.prototype.SetProperty = function(name, value, priority) { return this.$val.SetProperty(name, value, priority); };
	CSSStyleDeclaration.ptr.prototype.Index = function(idx) {
		var css, idx;
		css = this;
		return $internalize(css.Object.index(idx), $String);
	};
	CSSStyleDeclaration.prototype.Index = function(idx) { return this.$val.Index(idx); };
	CSSStyleDeclaration.ptr.prototype.Length = function() {
		var css;
		css = this;
		return $parseInt(css.Object.length) >> 0;
	};
	CSSStyleDeclaration.prototype.Length = function() { return this.$val.Length(); };
	wrapEvent = function(o) {
		var _1, c, ev, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		ev = new BasicEvent.ptr(o);
		c = o.constructor;
		_1 = c;
		if (_1 === ($global.AnimationEvent)) {
			return new AnimationEvent.ptr(ev);
		} else if (_1 === ($global.AudioProcessingEvent)) {
			return new AudioProcessingEvent.ptr(ev);
		} else if (_1 === ($global.BeforeInputEvent)) {
			return new BeforeInputEvent.ptr(ev);
		} else if (_1 === ($global.BeforeUnloadEvent)) {
			return new BeforeUnloadEvent.ptr(ev);
		} else if (_1 === ($global.BlobEvent)) {
			return new BlobEvent.ptr(ev);
		} else if (_1 === ($global.ClipboardEvent)) {
			return new ClipboardEvent.ptr(ev);
		} else if (_1 === ($global.CloseEvent)) {
			return new CloseEvent.ptr(ev, 0, "", false);
		} else if (_1 === ($global.CompositionEvent)) {
			return new CompositionEvent.ptr(ev);
		} else if (_1 === ($global.CSSFontFaceLoadEvent)) {
			return new CSSFontFaceLoadEvent.ptr(ev);
		} else if (_1 === ($global.CustomEvent)) {
			return new CustomEvent.ptr(ev);
		} else if (_1 === ($global.DeviceLightEvent)) {
			return new DeviceLightEvent.ptr(ev);
		} else if (_1 === ($global.DeviceMotionEvent)) {
			return new DeviceMotionEvent.ptr(ev);
		} else if (_1 === ($global.DeviceOrientationEvent)) {
			return new DeviceOrientationEvent.ptr(ev);
		} else if (_1 === ($global.DeviceProximityEvent)) {
			return new DeviceProximityEvent.ptr(ev);
		} else if (_1 === ($global.DOMTransactionEvent)) {
			return new DOMTransactionEvent.ptr(ev);
		} else if (_1 === ($global.DragEvent)) {
			return new DragEvent.ptr(ev);
		} else if (_1 === ($global.EditingBeforeInputEvent)) {
			return new EditingBeforeInputEvent.ptr(ev);
		} else if (_1 === ($global.ErrorEvent)) {
			return new ErrorEvent.ptr(ev);
		} else if (_1 === ($global.FocusEvent)) {
			return new FocusEvent.ptr(ev);
		} else if (_1 === ($global.GamepadEvent)) {
			return new GamepadEvent.ptr(ev);
		} else if (_1 === ($global.HashChangeEvent)) {
			return new HashChangeEvent.ptr(ev);
		} else if (_1 === ($global.IDBVersionChangeEvent)) {
			return new IDBVersionChangeEvent.ptr(ev);
		} else if (_1 === ($global.KeyboardEvent)) {
			return new KeyboardEvent.ptr(ev, false, 0, false, "", "", 0, "", 0, 0, false, false, false);
		} else if (_1 === ($global.MediaStreamEvent)) {
			return new MediaStreamEvent.ptr(ev);
		} else if (_1 === ($global.MessageEvent)) {
			return new MessageEvent.ptr(ev, null);
		} else if (_1 === ($global.MouseEvent)) {
			return new MouseEvent.ptr(new UIEvent.ptr(ev), false, 0, 0, 0, false, false, 0, 0, 0, 0, false);
		} else if (_1 === ($global.MutationEvent)) {
			return new MutationEvent.ptr(ev);
		} else if (_1 === ($global.OfflineAudioCompletionEvent)) {
			return new OfflineAudioCompletionEvent.ptr(ev);
		} else if (_1 === ($global.PageTransitionEvent)) {
			return new PageTransitionEvent.ptr(ev);
		} else if (_1 === ($global.PointerEvent)) {
			return new PointerEvent.ptr(ev);
		} else if (_1 === ($global.PopStateEvent)) {
			return new PopStateEvent.ptr(ev);
		} else if (_1 === ($global.ProgressEvent)) {
			return new ProgressEvent.ptr(ev);
		} else if (_1 === ($global.RelatedEvent)) {
			return new RelatedEvent.ptr(ev);
		} else if (_1 === ($global.RTCPeerConnectionIceEvent)) {
			return new RTCPeerConnectionIceEvent.ptr(ev);
		} else if (_1 === ($global.SensorEvent)) {
			return new SensorEvent.ptr(ev);
		} else if (_1 === ($global.StorageEvent)) {
			return new StorageEvent.ptr(ev);
		} else if (_1 === ($global.SVGEvent)) {
			return new SVGEvent.ptr(ev);
		} else if (_1 === ($global.SVGZoomEvent)) {
			return new SVGZoomEvent.ptr(ev);
		} else if (_1 === ($global.TimeEvent)) {
			return new TimeEvent.ptr(ev);
		} else if (_1 === ($global.TouchEvent)) {
			return new TouchEvent.ptr(ev, false, false, false, false);
		} else if (_1 === ($global.TrackEvent)) {
			return new TrackEvent.ptr(ev);
		} else if (_1 === ($global.TransitionEvent)) {
			return new TransitionEvent.ptr(ev);
		} else if (_1 === ($global.UIEvent)) {
			return new UIEvent.ptr(ev);
		} else if (_1 === ($global.UserProximityEvent)) {
			return new UserProximityEvent.ptr(ev);
		} else if (_1 === ($global.WheelEvent)) {
			return new WheelEvent.ptr(new MouseEvent.ptr(new UIEvent.ptr(ev), false, 0, 0, 0, false, false, 0, 0, 0, 0, false), 0, 0, 0, 0);
		} else {
			return ev;
		}
	};
	BasicEvent.ptr.prototype.Bubbles = function() {
		var ev;
		ev = this;
		return !!(ev.Object.bubbles);
	};
	BasicEvent.prototype.Bubbles = function() { return this.$val.Bubbles(); };
	BasicEvent.ptr.prototype.Cancelable = function() {
		var ev;
		ev = this;
		return !!(ev.Object.cancelable);
	};
	BasicEvent.prototype.Cancelable = function() { return this.$val.Cancelable(); };
	BasicEvent.ptr.prototype.CurrentTarget = function() {
		var ev;
		ev = this;
		return wrapElement(ev.Object.currentTarget);
	};
	BasicEvent.prototype.CurrentTarget = function() { return this.$val.CurrentTarget(); };
	BasicEvent.ptr.prototype.DefaultPrevented = function() {
		var ev;
		ev = this;
		return !!(ev.Object.defaultPrevented);
	};
	BasicEvent.prototype.DefaultPrevented = function() { return this.$val.DefaultPrevented(); };
	BasicEvent.ptr.prototype.EventPhase = function() {
		var ev;
		ev = this;
		return $parseInt(ev.Object.eventPhase) >> 0;
	};
	BasicEvent.prototype.EventPhase = function() { return this.$val.EventPhase(); };
	BasicEvent.ptr.prototype.Target = function() {
		var ev;
		ev = this;
		return wrapElement(ev.Object.target);
	};
	BasicEvent.prototype.Target = function() { return this.$val.Target(); };
	BasicEvent.ptr.prototype.Timestamp = function() {
		var _q, _r, ev, ms, ns, s;
		ev = this;
		ms = $parseInt(ev.Object.timeStamp) >> 0;
		s = (_q = ms / 1000, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		ns = ($imul((_r = ms % 1000, _r === _r ? _r : $throwRuntimeError("integer divide by zero")), 1000000));
		return time.Unix((new $Int64(0, s)), (new $Int64(0, ns)));
	};
	BasicEvent.prototype.Timestamp = function() { return this.$val.Timestamp(); };
	BasicEvent.ptr.prototype.Type = function() {
		var ev;
		ev = this;
		return $internalize(ev.Object.type, $String);
	};
	BasicEvent.prototype.Type = function() { return this.$val.Type(); };
	BasicEvent.ptr.prototype.PreventDefault = function() {
		var ev;
		ev = this;
		ev.Object.preventDefault();
	};
	BasicEvent.prototype.PreventDefault = function() { return this.$val.PreventDefault(); };
	BasicEvent.ptr.prototype.StopImmediatePropagation = function() {
		var ev;
		ev = this;
		ev.Object.stopImmediatePropagation();
	};
	BasicEvent.prototype.StopImmediatePropagation = function() { return this.$val.StopImmediatePropagation(); };
	BasicEvent.ptr.prototype.StopPropagation = function() {
		var ev;
		ev = this;
		ev.Object.stopPropagation();
	};
	BasicEvent.prototype.StopPropagation = function() { return this.$val.StopPropagation(); };
	BasicEvent.ptr.prototype.Underlying = function() {
		var ev;
		ev = this;
		return ev.Object;
	};
	BasicEvent.prototype.Underlying = function() { return this.$val.Underlying(); };
	FocusEvent.ptr.prototype.RelatedTarget = function() {
		var ev;
		ev = this;
		return wrapElement(ev.BasicEvent.Object.relatedTarget);
	};
	FocusEvent.prototype.RelatedTarget = function() { return this.$val.RelatedTarget(); };
	KeyboardEvent.ptr.prototype.ModifierState = function(mod) {
		var ev, mod;
		ev = this;
		return !!(ev.BasicEvent.Object.getModifierState($externalize(mod, $String)));
	};
	KeyboardEvent.prototype.ModifierState = function(mod) { return this.$val.ModifierState(mod); };
	MouseEvent.ptr.prototype.RelatedTarget = function() {
		var ev;
		ev = this;
		return wrapElement(ev.UIEvent.BasicEvent.Object.relatedTarget);
	};
	MouseEvent.prototype.RelatedTarget = function() { return this.$val.RelatedTarget(); };
	MouseEvent.ptr.prototype.ModifierState = function(mod) {
		var ev, mod;
		ev = this;
		return !!(ev.UIEvent.BasicEvent.Object.getModifierState($externalize(mod, $String)));
	};
	MouseEvent.prototype.ModifierState = function(mod) { return this.$val.ModifierState(mod); };
	TouchEvent.ptr.prototype.ChangedTouches = function() {
		var ev;
		ev = this;
		return touchListToTouches(ev.BasicEvent.Object.changedTouches);
	};
	TouchEvent.prototype.ChangedTouches = function() { return this.$val.ChangedTouches(); };
	TouchEvent.ptr.prototype.TargetTouches = function() {
		var ev;
		ev = this;
		return touchListToTouches(ev.BasicEvent.Object.targetTouches);
	};
	TouchEvent.prototype.TargetTouches = function() { return this.$val.TargetTouches(); };
	TouchEvent.ptr.prototype.Touches = function() {
		var ev;
		ev = this;
		return touchListToTouches(ev.BasicEvent.Object.touches);
	};
	TouchEvent.prototype.Touches = function() { return this.$val.Touches(); };
	touchListToTouches = function(tl) {
		var _i, _ref, i, out, tl;
		out = $makeSlice(sliceType$17, $parseInt(tl.length));
		_ref = out;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i] = new Touch.ptr(tl[i], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
			_i++;
		}
		return out;
	};
	Touch.ptr.prototype.Target = function() {
		var t;
		t = this;
		return wrapElement(t.Object.target);
	};
	Touch.prototype.Target = function() { return this.$val.Target(); };
	ptrType$23.methods = [{prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [$String], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Remove", name: "Remove", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Toggle", name: "Toggle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([], [sliceType$7], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([sliceType$7], [], false)}];
	documentFragment.methods = [{prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}];
	document.methods = [{prop: "Async", name: "Async", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetAsync", name: "SetAsync", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Doctype", name: "Doctype", pkg: "", typ: $funcType([], [DocumentType], false)}, {prop: "DocumentElement", name: "DocumentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DocumentURI", name: "DocumentURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Implementation", name: "Implementation", pkg: "", typ: $funcType([], [DOMImplementation], false)}, {prop: "LastStyleSheetSet", name: "LastStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreferredStyleSheetSet", name: "PreferredStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SelectedStyleSheetSet", name: "SelectedStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "StyleSheets", name: "StyleSheets", pkg: "", typ: $funcType([], [sliceType$18], false)}, {prop: "StyleSheetSets", name: "StyleSheetSets", pkg: "", typ: $funcType([], [sliceType$18], false)}, {prop: "AdoptNode", name: "AdoptNode", pkg: "", typ: $funcType([Node], [Node], false)}, {prop: "ImportNode", name: "ImportNode", pkg: "", typ: $funcType([Node, $Bool], [Node], false)}, {prop: "CreateDocumentFragment", name: "CreateDocumentFragment", pkg: "", typ: $funcType([], [DocumentFragment], false)}, {prop: "CreateElement", name: "CreateElement", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CreateElementNS", name: "CreateElementNS", pkg: "", typ: $funcType([$String, $String], [Element], false)}, {prop: "CreateTextNode", name: "CreateTextNode", pkg: "", typ: $funcType([$String], [ptrType$12], false)}, {prop: "ElementFromPoint", name: "ElementFromPoint", pkg: "", typ: $funcType([$Int, $Int], [Element], false)}, {prop: "EnableStyleSheetsForSet", name: "EnableStyleSheetsForSet", pkg: "", typ: $funcType([$String], [], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}];
	ptrType$27.methods = [{prop: "ActiveElement", name: "ActiveElement", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Body", name: "Body", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Cookie", name: "Cookie", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCookie", name: "SetCookie", pkg: "", typ: $funcType([$String], [], false)}, {prop: "DefaultView", name: "DefaultView", pkg: "", typ: $funcType([], [Window], false)}, {prop: "DesignMode", name: "DesignMode", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetDesignMode", name: "SetDesignMode", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Domain", name: "Domain", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDomain", name: "SetDomain", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Forms", name: "Forms", pkg: "", typ: $funcType([], [sliceType$8], false)}, {prop: "Head", name: "Head", pkg: "", typ: $funcType([], [ptrType$8], false)}, {prop: "Images", name: "Images", pkg: "", typ: $funcType([], [sliceType$9], false)}, {prop: "LastModified", name: "LastModified", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Links", name: "Links", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$24], false)}, {prop: "Plugins", name: "Plugins", pkg: "", typ: $funcType([], [sliceType$10], false)}, {prop: "ReadyState", name: "ReadyState", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Referrer", name: "Referrer", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Scripts", name: "Scripts", pkg: "", typ: $funcType([], [sliceType$11], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "URL", name: "URL", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$31.methods = [{prop: "Console", name: "Console", pkg: "", typ: $funcType([], [ptrType$29], false)}, {prop: "Document", name: "Document", pkg: "", typ: $funcType([], [Document], false)}, {prop: "FrameElement", name: "FrameElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$24], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetName", name: "SetName", pkg: "", typ: $funcType([$String], [], false)}, {prop: "InnerHeight", name: "InnerHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "InnerWidth", name: "InnerWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Opener", name: "Opener", pkg: "", typ: $funcType([], [Window], false)}, {prop: "OuterHeight", name: "OuterHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OuterWidth", name: "OuterWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollX", name: "ScrollX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollY", name: "ScrollY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Parent", name: "Parent", pkg: "", typ: $funcType([], [Window], false)}, {prop: "ScreenX", name: "ScreenX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScreenY", name: "ScreenY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxX", name: "ScrollMaxX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxY", name: "ScrollMaxY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [Window], false)}, {prop: "History", name: "History", pkg: "", typ: $funcType([], [History], false)}, {prop: "Navigator", name: "Navigator", pkg: "", typ: $funcType([], [Navigator], false)}, {prop: "Screen", name: "Screen", pkg: "", typ: $funcType([], [ptrType$30], false)}, {prop: "Alert", name: "Alert", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "ClearInterval", name: "ClearInterval", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearTimeout", name: "ClearTimeout", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Confirm", name: "Confirm", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "GetComputedStyle", name: "GetComputedStyle", pkg: "", typ: $funcType([Element, $String], [ptrType$28], false)}, {prop: "GetSelection", name: "GetSelection", pkg: "", typ: $funcType([], [Selection], false)}, {prop: "Home", name: "Home", pkg: "", typ: $funcType([], [], false)}, {prop: "MoveBy", name: "MoveBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([$String, $String, $String], [Window], false)}, {prop: "OpenDialog", name: "OpenDialog", pkg: "", typ: $funcType([$String, $String, $String, sliceType], [Window], false)}, {prop: "PostMessage", name: "PostMessage", pkg: "", typ: $funcType([$String, $String, sliceType], [], false)}, {prop: "Print", name: "Print", pkg: "", typ: $funcType([], [], false)}, {prop: "Prompt", name: "Prompt", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "ResizeBy", name: "ResizeBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ResizeTo", name: "ResizeTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Scroll", name: "Scroll", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollBy", name: "ScrollBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollByLines", name: "ScrollByLines", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ScrollTo", name: "ScrollTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "SetCursor", name: "SetCursor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInterval", name: "SetInterval", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "SetTimeout", name: "SetTimeout", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "RequestAnimationFrame", name: "RequestAnimationFrame", pkg: "", typ: $funcType([funcType$3], [$Int], false)}, {prop: "CancelAnimationFrame", name: "CancelAnimationFrame", pkg: "", typ: $funcType([$Int], [], false)}];
	ptrType$32.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$25.methods = [{prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}];
	ptrType$1.methods = [{prop: "AccessKey", name: "AccessKey", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Dataset", name: "Dataset", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "SetAccessKey", name: "SetAccessKey", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AccessKeyLabel", name: "AccessKeyLabel", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAccessKeyLabel", name: "SetAccessKeyLabel", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ContentEditable", name: "ContentEditable", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetContentEditable", name: "SetContentEditable", pkg: "", typ: $funcType([$String], [], false)}, {prop: "IsContentEditable", name: "IsContentEditable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Dir", name: "Dir", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDir", name: "SetDir", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Draggable", name: "Draggable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetDraggable", name: "SetDraggable", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Lang", name: "Lang", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetLang", name: "SetLang", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OffsetHeight", name: "OffsetHeight", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetLeft", name: "OffsetLeft", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetParent", name: "OffsetParent", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "OffsetTop", name: "OffsetTop", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetWidth", name: "OffsetWidth", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Style", name: "Style", pkg: "", typ: $funcType([], [ptrType$28], false)}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "SetTabIndex", name: "SetTabIndex", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "Click", name: "Click", pkg: "", typ: $funcType([], [], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}];
	ptrType$34.methods = [{prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "SetClass", name: "SetClass", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Closest", name: "Closest", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "Matches", name: "Matches", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$35.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$23], false)}];
	ptrType$36.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$23], false)}];
	ptrType$16.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$23], false)}];
	ptrType$37.methods = [{prop: "Href", name: "Href", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$39.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$41.methods = [{prop: "GetContext2d", name: "GetContext2d", pkg: "", typ: $funcType([], [ptrType$40], false)}, {prop: "GetContext", name: "GetContext", pkg: "", typ: $funcType([$String], [ptrType], false)}];
	ptrType$40.methods = [{prop: "ClearRect", name: "ClearRect", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "FillRect", name: "FillRect", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "StrokeRect", name: "StrokeRect", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "FillText", name: "FillText", pkg: "", typ: $funcType([$String, $Float64, $Float64, $Float64], [], false)}, {prop: "StrokeText", name: "StrokeText", pkg: "", typ: $funcType([$String, $Float64, $Float64, $Float64], [], false)}, {prop: "MeasureText", name: "MeasureText", pkg: "", typ: $funcType([$String], [ptrType$42], false)}, {prop: "GetLineDash", name: "GetLineDash", pkg: "", typ: $funcType([], [sliceType$12], false)}, {prop: "SetLineDash", name: "SetLineDash", pkg: "", typ: $funcType([sliceType$12], [], false)}, {prop: "CreateLinearGradient", name: "CreateLinearGradient", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [ptrType$43], false)}, {prop: "CreateRadialGradient", name: "CreateRadialGradient", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Float64], [ptrType$43], false)}, {prop: "CreatePattern", name: "CreatePattern", pkg: "", typ: $funcType([Element, $String], [ptrType$44], false)}, {prop: "BeginPath", name: "BeginPath", pkg: "", typ: $funcType([], [], false)}, {prop: "ClosePath", name: "ClosePath", pkg: "", typ: $funcType([], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Float64, $Float64], [], false)}, {prop: "LineTo", name: "LineTo", pkg: "", typ: $funcType([$Float64, $Float64], [], false)}, {prop: "BezierCurveTo", name: "BezierCurveTo", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "QuadraticCurveTo", name: "QuadraticCurveTo", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "Arc", name: "Arc", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Bool], [], false)}, {prop: "ArcTo", name: "ArcTo", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "Ellipse", name: "Ellipse", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Float64, $Float64, $Bool], [], false)}, {prop: "Rect", name: "Rect", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "Fill", name: "Fill", pkg: "", typ: $funcType([], [], false)}, {prop: "Stroke", name: "Stroke", pkg: "", typ: $funcType([], [], false)}, {prop: "DrawFocusIfNeeded", name: "DrawFocusIfNeeded", pkg: "", typ: $funcType([HTMLElement, ptrType], [], false)}, {prop: "ScrollPathIntoView", name: "ScrollPathIntoView", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "Clip", name: "Clip", pkg: "", typ: $funcType([], [], false)}, {prop: "IsPointInPath", name: "IsPointInPath", pkg: "", typ: $funcType([$Float64, $Float64], [$Bool], false)}, {prop: "IsPointInStroke", name: "IsPointInStroke", pkg: "", typ: $funcType([ptrType, $Float64, $Float64], [$Bool], false)}, {prop: "Rotate", name: "Rotate", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "Scale", name: "Scale", pkg: "", typ: $funcType([$Float64, $Float64], [], false)}, {prop: "Translate", name: "Translate", pkg: "", typ: $funcType([$Float64, $Float64], [], false)}, {prop: "Transform", name: "Transform", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "SetTransform", name: "SetTransform", pkg: "", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "ResetTransform", name: "ResetTransform", pkg: "", typ: $funcType([], [], false)}, {prop: "DrawImage", name: "DrawImage", pkg: "", typ: $funcType([Element, $Float64, $Float64], [], false)}, {prop: "DrawImageWithDst", name: "DrawImageWithDst", pkg: "", typ: $funcType([Element, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "DrawImageWithSrcAndDst", name: "DrawImageWithSrcAndDst", pkg: "", typ: $funcType([Element, $Float64, $Float64, $Float64, $Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "CreateImageData", name: "CreateImageData", pkg: "", typ: $funcType([$Int, $Int], [ptrType$13], false)}, {prop: "GetImageData", name: "GetImageData", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [ptrType$13], false)}, {prop: "PutImageData", name: "PutImageData", pkg: "", typ: $funcType([ptrType$13, $Float64, $Float64], [], false)}, {prop: "PutImageDataDirty", name: "PutImageDataDirty", pkg: "", typ: $funcType([ptrType$13, $Float64, $Float64, $Int, $Int, $Int, $Int], [], false)}, {prop: "Save", name: "Save", pkg: "", typ: $funcType([], [], false)}, {prop: "Restore", name: "Restore", pkg: "", typ: $funcType([], [], false)}];
	ptrType$13.methods = [{prop: "ColorModel", name: "ColorModel", pkg: "", typ: $funcType([], [color.Model], false)}, {prop: "Bounds", name: "Bounds", pkg: "", typ: $funcType([], [image.Rectangle], false)}, {prop: "At", name: "At", pkg: "", typ: $funcType([$Int, $Int], [color.Color], false)}, {prop: "NRGBAAt", name: "NRGBAAt", pkg: "", typ: $funcType([$Int, $Int], [color.NRGBA], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$Int, $Int, color.Color], [], false)}, {prop: "SetNRGBA", name: "SetNRGBA", pkg: "", typ: $funcType([$Int, $Int, color.NRGBA], [], false)}];
	ptrType$43.methods = [{prop: "AddColorStop", name: "AddColorStop", pkg: "", typ: $funcType([$Float64, $String], [], false)}];
	ptrType$15.methods = [{prop: "Options", name: "Options", pkg: "", typ: $funcType([], [sliceType$6], false)}];
	ptrType$45.methods = [{prop: "Elements", name: "Elements", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$5.methods = [{prop: "Elements", name: "Elements", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Submit", name: "Submit", pkg: "", typ: $funcType([], [], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [HTMLElement], false)}, {prop: "NamedItem", name: "NamedItem", pkg: "", typ: $funcType([$String], [HTMLElement], false)}];
	ptrType$46.methods = [{prop: "ContentDocument", name: "ContentDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ContentWindow", name: "ContentWindow", pkg: "", typ: $funcType([], [Window], false)}];
	ptrType$47.methods = [{prop: "Files", name: "Files", pkg: "", typ: $funcType([], [sliceType$13], false)}, {prop: "List", name: "List", pkg: "", typ: $funcType([], [ptrType$15], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Select", name: "Select", pkg: "", typ: $funcType([], [], false)}, {prop: "SetSelectionRange", name: "SetSelectionRange", pkg: "", typ: $funcType([$Int, $Int, $String], [], false)}, {prop: "StepDown", name: "StepDown", pkg: "", typ: $funcType([$Int], [$error], false)}, {prop: "StepUp", name: "StepUp", pkg: "", typ: $funcType([$Int], [$error], false)}];
	ptrType$48.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$6.methods = [{prop: "Control", name: "Control", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$49.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$50.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "Sizes", name: "Sizes", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "Sheet", name: "Sheet", pkg: "", typ: $funcType([], [StyleSheet], false)}];
	ptrType$51.methods = [{prop: "Areas", name: "Areas", pkg: "", typ: $funcType([], [sliceType$14], false)}, {prop: "Images", name: "Images", pkg: "", typ: $funcType([], [sliceType$4], false)}];
	ptrType$3.methods = [{prop: "Play", name: "Play", pkg: "", typ: $funcType([], [], false)}, {prop: "Pause", name: "Pause", pkg: "", typ: $funcType([], [], false)}];
	HTMLMeterElement.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}];
	ptrType$52.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "ContentDocument", name: "ContentDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ContentWindow", name: "ContentWindow", pkg: "", typ: $funcType([], [Window], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$7.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$53.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "For", name: "For", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	HTMLProgressElement.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}];
	ptrType$54.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Options", name: "Options", pkg: "", typ: $funcType([], [sliceType$6], false)}, {prop: "SelectedOptions", name: "SelectedOptions", pkg: "", typ: $funcType([], [sliceType$6], false)}, {prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [ptrType$7], false)}, {prop: "NamedItem", name: "NamedItem", pkg: "", typ: $funcType([$String], [ptrType$7], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$18.methods = [{prop: "Cells", name: "Cells", pkg: "", typ: $funcType([], [sliceType$15], false)}, {prop: "InsertCell", name: "InsertCell", pkg: "", typ: $funcType([$Int], [ptrType$17], false)}, {prop: "DeleteCell", name: "DeleteCell", pkg: "", typ: $funcType([$Int], [], false)}];
	ptrType$55.methods = [{prop: "Rows", name: "Rows", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "DeleteRow", name: "DeleteRow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "InsertRow", name: "InsertRow", pkg: "", typ: $funcType([$Int], [ptrType$18], false)}];
	ptrType$56.methods = [{prop: "Content", name: "Content", pkg: "", typ: $funcType([], [DocumentFragment], false)}];
	ptrType$57.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$38], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Select", name: "Select", pkg: "", typ: $funcType([], [], false)}, {prop: "SetSelectionRange", name: "SetSelectionRange", pkg: "", typ: $funcType([$Int, $Int, $String], [], false)}];
	ptrType$59.methods = [{prop: "Track", name: "Track", pkg: "", typ: $funcType([], [ptrType$58], false)}];
	ptrType$28.methods = [{prop: "ToMap", name: "ToMap", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "RemoveProperty", name: "RemoveProperty", pkg: "", typ: $funcType([$String], [], false)}, {prop: "GetPropertyValue", name: "GetPropertyValue", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetPropertyPriority", name: "GetPropertyPriority", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "SetProperty", name: "SetProperty", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [$String], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}];
	ptrType$19.methods = [{prop: "Bubbles", name: "Bubbles", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Cancelable", name: "Cancelable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CurrentTarget", name: "CurrentTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DefaultPrevented", name: "DefaultPrevented", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "EventPhase", name: "EventPhase", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Timestamp", name: "Timestamp", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreventDefault", name: "PreventDefault", pkg: "", typ: $funcType([], [], false)}, {prop: "StopImmediatePropagation", name: "StopImmediatePropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "StopPropagation", name: "StopPropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}];
	ptrType$60.methods = [{prop: "RelatedTarget", name: "RelatedTarget", pkg: "", typ: $funcType([], [Element], false)}];
	ptrType$61.methods = [{prop: "ModifierState", name: "ModifierState", pkg: "", typ: $funcType([$String], [$Bool], false)}];
	ptrType$21.methods = [{prop: "RelatedTarget", name: "RelatedTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ModifierState", name: "ModifierState", pkg: "", typ: $funcType([$String], [$Bool], false)}];
	ptrType$62.methods = [{prop: "ChangedTouches", name: "ChangedTouches", pkg: "", typ: $funcType([], [sliceType$17], false)}, {prop: "TargetTouches", name: "TargetTouches", pkg: "", typ: $funcType([], [sliceType$17], false)}, {prop: "Touches", name: "Touches", pkg: "", typ: $funcType([], [sliceType$17], false)}];
	ptrType$22.methods = [{prop: "Target", name: "Target", pkg: "", typ: $funcType([], [Element], false)}];
	TokenList.init("honnef.co/go/js/dom", [{prop: "dtl", name: "dtl", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "o", name: "o", embedded: false, exported: false, typ: ptrType, tag: ""}, {prop: "sa", name: "sa", embedded: false, exported: false, typ: $String, tag: ""}, {prop: "Length", name: "Length", embedded: false, exported: true, typ: $Int, tag: "js:\"length\""}]);
	Document.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AdoptNode", name: "AdoptNode", pkg: "", typ: $funcType([Node], [Node], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Async", name: "Async", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "CreateDocumentFragment", name: "CreateDocumentFragment", pkg: "", typ: $funcType([], [DocumentFragment], false)}, {prop: "CreateElement", name: "CreateElement", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CreateElementNS", name: "CreateElementNS", pkg: "", typ: $funcType([$String, $String], [Element], false)}, {prop: "CreateTextNode", name: "CreateTextNode", pkg: "", typ: $funcType([$String], [ptrType$12], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "Doctype", name: "Doctype", pkg: "", typ: $funcType([], [DocumentType], false)}, {prop: "DocumentElement", name: "DocumentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DocumentURI", name: "DocumentURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ElementFromPoint", name: "ElementFromPoint", pkg: "", typ: $funcType([$Int, $Int], [Element], false)}, {prop: "EnableStyleSheetsForSet", name: "EnableStyleSheetsForSet", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Implementation", name: "Implementation", pkg: "", typ: $funcType([], [DOMImplementation], false)}, {prop: "ImportNode", name: "ImportNode", pkg: "", typ: $funcType([Node, $Bool], [Node], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LastStyleSheetSet", name: "LastStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreferredStyleSheetSet", name: "PreferredStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SelectedStyleSheetSet", name: "SelectedStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAsync", name: "SetAsync", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "StyleSheetSets", name: "StyleSheetSets", pkg: "", typ: $funcType([], [sliceType$18], false)}, {prop: "StyleSheets", name: "StyleSheets", pkg: "", typ: $funcType([], [sliceType$18], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	DocumentFragment.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	documentFragment.init("", [{prop: "BasicNode", name: "BasicNode", embedded: true, exported: true, typ: ptrType$25, tag: ""}]);
	document.init("", [{prop: "BasicNode", name: "BasicNode", embedded: true, exported: true, typ: ptrType$25, tag: ""}]);
	htmlDocument.init("honnef.co/go/js/dom", [{prop: "document", name: "document", embedded: true, exported: false, typ: ptrType$26, tag: ""}]);
	URLUtils.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Href", name: "Href", embedded: false, exported: true, typ: $String, tag: "js:\"href\""}, {prop: "Protocol", name: "Protocol", embedded: false, exported: true, typ: $String, tag: "js:\"protocol\""}, {prop: "Host", name: "Host", embedded: false, exported: true, typ: $String, tag: "js:\"host\""}, {prop: "Hostname", name: "Hostname", embedded: false, exported: true, typ: $String, tag: "js:\"hostname\""}, {prop: "Port", name: "Port", embedded: false, exported: true, typ: $String, tag: "js:\"port\""}, {prop: "Pathname", name: "Pathname", embedded: false, exported: true, typ: $String, tag: "js:\"pathname\""}, {prop: "Search", name: "Search", embedded: false, exported: true, typ: $String, tag: "js:\"search\""}, {prop: "Hash", name: "Hash", embedded: false, exported: true, typ: $String, tag: "js:\"hash\""}, {prop: "Username", name: "Username", embedded: false, exported: true, typ: $String, tag: "js:\"username\""}, {prop: "Password", name: "Password", embedded: false, exported: true, typ: $String, tag: "js:\"password\""}, {prop: "Origin", name: "Origin", embedded: false, exported: true, typ: $String, tag: "js:\"origin\""}]);
	Location.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "URLUtils", name: "URLUtils", embedded: true, exported: true, typ: ptrType$2, tag: ""}]);
	HTMLElement.init([{prop: "AccessKey", name: "AccessKey", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AccessKeyLabel", name: "AccessKeyLabel", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "Click", name: "Click", pkg: "", typ: $funcType([], [], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "Closest", name: "Closest", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "ContentEditable", name: "ContentEditable", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Dataset", name: "Dataset", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "Dir", name: "Dir", pkg: "", typ: $funcType([], [$String], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "Draggable", name: "Draggable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsContentEditable", name: "IsContentEditable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "Lang", name: "Lang", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Matches", name: "Matches", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OffsetHeight", name: "OffsetHeight", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetLeft", name: "OffsetLeft", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetParent", name: "OffsetParent", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "OffsetTop", name: "OffsetTop", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetWidth", name: "OffsetWidth", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetAccessKey", name: "SetAccessKey", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetAccessKeyLabel", name: "SetAccessKeyLabel", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "SetContentEditable", name: "SetContentEditable", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetDir", name: "SetDir", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetDraggable", name: "SetDraggable", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetLang", name: "SetLang", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Style", name: "Style", pkg: "", typ: $funcType([], [ptrType$28], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	Window.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "Alert", name: "Alert", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "CancelAnimationFrame", name: "CancelAnimationFrame", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearInterval", name: "ClearInterval", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearTimeout", name: "ClearTimeout", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Confirm", name: "Confirm", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Console", name: "Console", pkg: "", typ: $funcType([], [ptrType$29], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "Document", name: "Document", pkg: "", typ: $funcType([], [Document], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "FrameElement", name: "FrameElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "GetComputedStyle", name: "GetComputedStyle", pkg: "", typ: $funcType([Element, $String], [ptrType$28], false)}, {prop: "GetSelection", name: "GetSelection", pkg: "", typ: $funcType([], [Selection], false)}, {prop: "History", name: "History", pkg: "", typ: $funcType([], [History], false)}, {prop: "Home", name: "Home", pkg: "", typ: $funcType([], [], false)}, {prop: "InnerHeight", name: "InnerHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "InnerWidth", name: "InnerWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$24], false)}, {prop: "MoveBy", name: "MoveBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Navigator", name: "Navigator", pkg: "", typ: $funcType([], [Navigator], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([$String, $String, $String], [Window], false)}, {prop: "OpenDialog", name: "OpenDialog", pkg: "", typ: $funcType([$String, $String, $String, sliceType], [Window], false)}, {prop: "Opener", name: "Opener", pkg: "", typ: $funcType([], [Window], false)}, {prop: "OuterHeight", name: "OuterHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OuterWidth", name: "OuterWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Parent", name: "Parent", pkg: "", typ: $funcType([], [Window], false)}, {prop: "PostMessage", name: "PostMessage", pkg: "", typ: $funcType([$String, $String, sliceType], [], false)}, {prop: "Print", name: "Print", pkg: "", typ: $funcType([], [], false)}, {prop: "Prompt", name: "Prompt", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "RequestAnimationFrame", name: "RequestAnimationFrame", pkg: "", typ: $funcType([funcType$3], [$Int], false)}, {prop: "ResizeBy", name: "ResizeBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ResizeTo", name: "ResizeTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Screen", name: "Screen", pkg: "", typ: $funcType([], [ptrType$30], false)}, {prop: "ScreenX", name: "ScreenX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScreenY", name: "ScreenY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Scroll", name: "Scroll", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollBy", name: "ScrollBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollByLines", name: "ScrollByLines", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ScrollMaxX", name: "ScrollMaxX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxY", name: "ScrollMaxY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollTo", name: "ScrollTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollX", name: "ScrollX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollY", name: "ScrollY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "SetCursor", name: "SetCursor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInterval", name: "SetInterval", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "SetName", name: "SetName", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTimeout", name: "SetTimeout", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [Window], false)}]);
	window.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	Selection.init([]);
	Screen.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "AvailTop", name: "AvailTop", embedded: false, exported: true, typ: $Int, tag: "js:\"availTop\""}, {prop: "AvailLeft", name: "AvailLeft", embedded: false, exported: true, typ: $Int, tag: "js:\"availLeft\""}, {prop: "AvailHeight", name: "AvailHeight", embedded: false, exported: true, typ: $Int, tag: "js:\"availHeight\""}, {prop: "AvailWidth", name: "AvailWidth", embedded: false, exported: true, typ: $Int, tag: "js:\"availWidth\""}, {prop: "ColorDepth", name: "ColorDepth", embedded: false, exported: true, typ: $Int, tag: "js:\"colorDepth\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $Int, tag: "js:\"height\""}, {prop: "Left", name: "Left", embedded: false, exported: true, typ: $Int, tag: "js:\"left\""}, {prop: "PixelDepth", name: "PixelDepth", embedded: false, exported: true, typ: $Int, tag: "js:\"pixelDepth\""}, {prop: "Top", name: "Top", embedded: false, exported: true, typ: $Int, tag: "js:\"top\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Int, tag: "js:\"width\""}]);
	Navigator.init([{prop: "AppName", name: "AppName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AppVersion", name: "AppVersion", pkg: "", typ: $funcType([], [$String], false)}, {prop: "CookieEnabled", name: "CookieEnabled", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "DoNotTrack", name: "DoNotTrack", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Geolocation", name: "Geolocation", pkg: "", typ: $funcType([], [Geolocation], false)}, {prop: "Language", name: "Language", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Online", name: "Online", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Platform", name: "Platform", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Product", name: "Product", pkg: "", typ: $funcType([], [$String], false)}, {prop: "RegisterProtocolHandler", name: "RegisterProtocolHandler", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "UserAgent", name: "UserAgent", pkg: "", typ: $funcType([], [$String], false)}]);
	Geolocation.init([{prop: "ClearWatch", name: "ClearWatch", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "CurrentPosition", name: "CurrentPosition", pkg: "", typ: $funcType([funcType$4, funcType$5, PositionOptions], [Position], false)}, {prop: "WatchPosition", name: "WatchPosition", pkg: "", typ: $funcType([funcType$4, funcType$5, PositionOptions], [$Int], false)}]);
	PositionError.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Code", name: "Code", embedded: false, exported: true, typ: $Int, tag: "js:\"code\""}]);
	PositionOptions.init("", [{prop: "EnableHighAccuracy", name: "EnableHighAccuracy", embedded: false, exported: true, typ: $Bool, tag: ""}, {prop: "Timeout", name: "Timeout", embedded: false, exported: true, typ: time.Duration, tag: ""}, {prop: "MaximumAge", name: "MaximumAge", embedded: false, exported: true, typ: time.Duration, tag: ""}]);
	Position.init("", [{prop: "Coords", name: "Coords", embedded: false, exported: true, typ: ptrType$33, tag: ""}, {prop: "Timestamp", name: "Timestamp", embedded: false, exported: true, typ: time.Time, tag: ""}]);
	Coordinates.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Latitude", name: "Latitude", embedded: false, exported: true, typ: $Float64, tag: "js:\"latitude\""}, {prop: "Longitude", name: "Longitude", embedded: false, exported: true, typ: $Float64, tag: "js:\"longitude\""}, {prop: "Altitude", name: "Altitude", embedded: false, exported: true, typ: $Float64, tag: "js:\"altitude\""}, {prop: "Accuracy", name: "Accuracy", embedded: false, exported: true, typ: $Float64, tag: "js:\"accuracy\""}, {prop: "AltitudeAccuracy", name: "AltitudeAccuracy", embedded: false, exported: true, typ: $Float64, tag: "js:\"altitudeAccuracy\""}, {prop: "Heading", name: "Heading", embedded: false, exported: true, typ: $Float64, tag: "js:\"heading\""}, {prop: "Speed", name: "Speed", embedded: false, exported: true, typ: $Float64, tag: "js:\"speed\""}]);
	History.init([{prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "Go", name: "Go", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "PushState", name: "PushState", pkg: "", typ: $funcType([$emptyInterface, $String, $String], [], false)}, {prop: "ReplaceState", name: "ReplaceState", pkg: "", typ: $funcType([$emptyInterface, $String, $String], [], false)}, {prop: "State", name: "State", pkg: "", typ: $funcType([], [$emptyInterface], false)}]);
	Console.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	DocumentType.init([]);
	DOMImplementation.init([]);
	StyleSheet.init([]);
	Node.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	BasicNode.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	Element.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$23], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "Closest", name: "Closest", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "DispatchEvent", name: "DispatchEvent", pkg: "", typ: $funcType([Event], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Matches", name: "Matches", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	ClientRect.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $Float64, tag: "js:\"height\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Float64, tag: "js:\"width\""}, {prop: "Left", name: "Left", embedded: false, exported: true, typ: $Float64, tag: "js:\"left\""}, {prop: "Right", name: "Right", embedded: false, exported: true, typ: $Float64, tag: "js:\"right\""}, {prop: "Top", name: "Top", embedded: false, exported: true, typ: $Float64, tag: "js:\"top\""}, {prop: "Bottom", name: "Bottom", embedded: false, exported: true, typ: $Float64, tag: "js:\"bottom\""}]);
	BasicHTMLElement.init("", [{prop: "BasicElement", name: "BasicElement", embedded: true, exported: true, typ: ptrType$34, tag: ""}]);
	BasicElement.init("", [{prop: "BasicNode", name: "BasicNode", embedded: true, exported: true, typ: ptrType$25, tag: ""}]);
	HTMLAnchorElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "URLUtils", name: "URLUtils", embedded: true, exported: true, typ: ptrType$2, tag: ""}, {prop: "HrefLang", name: "HrefLang", embedded: false, exported: true, typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", embedded: false, exported: true, typ: $String, tag: "js:\"media\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", embedded: false, exported: true, typ: $String, tag: "js:\"target\""}, {prop: "Text", name: "Text", embedded: false, exported: true, typ: $String, tag: "js:\"text\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLAppletElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Alt", name: "Alt", embedded: false, exported: true, typ: $String, tag: "js:\"alt\""}, {prop: "Coords", name: "Coords", embedded: false, exported: true, typ: $String, tag: "js:\"coords\""}, {prop: "HrefLang", name: "HrefLang", embedded: false, exported: true, typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", embedded: false, exported: true, typ: $String, tag: "js:\"media\""}, {prop: "Search", name: "Search", embedded: false, exported: true, typ: $String, tag: "js:\"search\""}, {prop: "Shape", name: "Shape", embedded: false, exported: true, typ: $String, tag: "js:\"shape\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", embedded: false, exported: true, typ: $String, tag: "js:\"target\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLAreaElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "URLUtils", name: "URLUtils", embedded: true, exported: true, typ: ptrType$2, tag: ""}, {prop: "Alt", name: "Alt", embedded: false, exported: true, typ: $String, tag: "js:\"alt\""}, {prop: "Coords", name: "Coords", embedded: false, exported: true, typ: $String, tag: "js:\"coords\""}, {prop: "HrefLang", name: "HrefLang", embedded: false, exported: true, typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", embedded: false, exported: true, typ: $String, tag: "js:\"media\""}, {prop: "Search", name: "Search", embedded: false, exported: true, typ: $String, tag: "js:\"search\""}, {prop: "Shape", name: "Shape", embedded: false, exported: true, typ: $String, tag: "js:\"shape\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", embedded: false, exported: true, typ: $String, tag: "js:\"target\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLAudioElement.init("", [{prop: "HTMLMediaElement", name: "HTMLMediaElement", embedded: true, exported: true, typ: ptrType$3, tag: ""}]);
	HTMLBRElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLBaseElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLBodyElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLButtonElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "AutoFocus", name: "AutoFocus", embedded: false, exported: true, typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "FormAction", name: "FormAction", embedded: false, exported: true, typ: $String, tag: "js:\"formAction\""}, {prop: "FormEncType", name: "FormEncType", embedded: false, exported: true, typ: $String, tag: "js:\"formEncType\""}, {prop: "FormMethod", name: "FormMethod", embedded: false, exported: true, typ: $String, tag: "js:\"formMethod\""}, {prop: "FormNoValidate", name: "FormNoValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"formNoValidate\""}, {prop: "FormTarget", name: "FormTarget", embedded: false, exported: true, typ: $String, tag: "js:\"formTarget\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLCanvasElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $Int, tag: "js:\"height\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Int, tag: "js:\"width\""}]);
	CanvasRenderingContext2D.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "FillStyle", name: "FillStyle", embedded: false, exported: true, typ: $String, tag: "js:\"fillStyle\""}, {prop: "StrokeStyle", name: "StrokeStyle", embedded: false, exported: true, typ: $String, tag: "js:\"strokeStyle\""}, {prop: "ShadowColor", name: "ShadowColor", embedded: false, exported: true, typ: $String, tag: "js:\"shadowColor\""}, {prop: "ShadowBlur", name: "ShadowBlur", embedded: false, exported: true, typ: $Int, tag: "js:\"shadowBlur\""}, {prop: "ShadowOffsetX", name: "ShadowOffsetX", embedded: false, exported: true, typ: $Int, tag: "js:\"shadowOffsetX\""}, {prop: "ShadowOffsetY", name: "ShadowOffsetY", embedded: false, exported: true, typ: $Int, tag: "js:\"shadowOffsetY\""}, {prop: "LineCap", name: "LineCap", embedded: false, exported: true, typ: $String, tag: "js:\"lineCap\""}, {prop: "LineJoin", name: "LineJoin", embedded: false, exported: true, typ: $String, tag: "js:\"lineJoin\""}, {prop: "LineWidth", name: "LineWidth", embedded: false, exported: true, typ: $Int, tag: "js:\"lineWidth\""}, {prop: "MiterLimit", name: "MiterLimit", embedded: false, exported: true, typ: $Int, tag: "js:\"miterLimit\""}, {prop: "Font", name: "Font", embedded: false, exported: true, typ: $String, tag: "js:\"font\""}, {prop: "TextAlign", name: "TextAlign", embedded: false, exported: true, typ: $String, tag: "js:\"textAlign\""}, {prop: "TextBaseline", name: "TextBaseline", embedded: false, exported: true, typ: $String, tag: "js:\"textBaseline\""}, {prop: "GlobalAlpha", name: "GlobalAlpha", embedded: false, exported: true, typ: $Float64, tag: "js:\"globalAlpha\""}, {prop: "GlobalCompositeOperation", name: "GlobalCompositeOperation", embedded: false, exported: true, typ: $String, tag: "js:\"globalCompositeOperation\""}]);
	ImageData.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Int, tag: "js:\"width\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $Int, tag: "js:\"height\""}, {prop: "Data", name: "Data", embedded: false, exported: true, typ: ptrType, tag: "js:\"data\""}]);
	CanvasGradient.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	CanvasPattern.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	TextMetrics.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Float64, tag: "js:\"width\""}, {prop: "ActualBoundingBoxLeft", name: "ActualBoundingBoxLeft", embedded: false, exported: true, typ: $Float64, tag: "js:\"actualBoundingBoxLeft\""}, {prop: "ActualBoundingBoxRight", name: "ActualBoundingBoxRight", embedded: false, exported: true, typ: $Float64, tag: "js:\"actualBoundingBoxRight\""}, {prop: "FontBoundingBoxAscent", name: "FontBoundingBoxAscent", embedded: false, exported: true, typ: $Float64, tag: "js:\"fontBoundingBoxAscent\""}, {prop: "FontBoundingBoxDescent", name: "FontBoundingBoxDescent", embedded: false, exported: true, typ: $Float64, tag: "js:\"fontBoundingBoxDescent\""}, {prop: "ActualBoundingBoxAscent", name: "ActualBoundingBoxAscent", embedded: false, exported: true, typ: $Float64, tag: "js:\"actualBoundingBoxAscent\""}, {prop: "ActualBoundingBoxDescent", name: "ActualBoundingBoxDescent", embedded: false, exported: true, typ: $Float64, tag: "js:\"actualBoundingBoxDescent\""}, {prop: "EmHeightAscent", name: "EmHeightAscent", embedded: false, exported: true, typ: $Float64, tag: "js:\"emHeightAscent\""}, {prop: "EmHeightDescent", name: "EmHeightDescent", embedded: false, exported: true, typ: $Float64, tag: "js:\"emHeightDescent\""}, {prop: "HangingBaseline", name: "HangingBaseline", embedded: false, exported: true, typ: $Float64, tag: "js:\"hangingBaseline\""}, {prop: "AlphabeticBaseline", name: "AlphabeticBaseline", embedded: false, exported: true, typ: $Float64, tag: "js:\"alphabeticBaseline\""}, {prop: "IdeographicBaseline", name: "IdeographicBaseline", embedded: false, exported: true, typ: $Float64, tag: "js:\"ideographicBaseline\""}]);
	HTMLDListElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLDataElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}]);
	HTMLDataListElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLDirectoryElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLDivElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLEmbedElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $String, tag: "js:\"width\""}]);
	HTMLFieldSetElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLFontElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLFormElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "AcceptCharset", name: "AcceptCharset", embedded: false, exported: true, typ: $String, tag: "js:\"acceptCharset\""}, {prop: "Action", name: "Action", embedded: false, exported: true, typ: $String, tag: "js:\"action\""}, {prop: "Autocomplete", name: "Autocomplete", embedded: false, exported: true, typ: $String, tag: "js:\"autocomplete\""}, {prop: "Encoding", name: "Encoding", embedded: false, exported: true, typ: $String, tag: "js:\"encoding\""}, {prop: "Enctype", name: "Enctype", embedded: false, exported: true, typ: $String, tag: "js:\"enctype\""}, {prop: "Length", name: "Length", embedded: false, exported: true, typ: $Int, tag: "js:\"length\""}, {prop: "Method", name: "Method", embedded: false, exported: true, typ: $String, tag: "js:\"method\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "NoValidate", name: "NoValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"noValidate\""}, {prop: "Target", name: "Target", embedded: false, exported: true, typ: $String, tag: "js:\"target\""}]);
	HTMLFrameElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLFrameSetElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLHRElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLHeadElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLHeadingElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLHtmlElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLIFrameElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $String, tag: "js:\"width\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $String, tag: "js:\"height\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "SrcDoc", name: "SrcDoc", embedded: false, exported: true, typ: $String, tag: "js:\"srcdoc\""}, {prop: "Seamless", name: "Seamless", embedded: false, exported: true, typ: $Bool, tag: "js:\"seamless\""}]);
	HTMLImageElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Complete", name: "Complete", embedded: false, exported: true, typ: $Bool, tag: "js:\"complete\""}, {prop: "CrossOrigin", name: "CrossOrigin", embedded: false, exported: true, typ: $String, tag: "js:\"crossOrigin\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $Int, tag: "js:\"height\""}, {prop: "IsMap", name: "IsMap", embedded: false, exported: true, typ: $Bool, tag: "js:\"isMap\""}, {prop: "NaturalHeight", name: "NaturalHeight", embedded: false, exported: true, typ: $Int, tag: "js:\"naturalHeight\""}, {prop: "NaturalWidth", name: "NaturalWidth", embedded: false, exported: true, typ: $Int, tag: "js:\"naturalWidth\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "UseMap", name: "UseMap", embedded: false, exported: true, typ: $String, tag: "js:\"useMap\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $Int, tag: "js:\"width\""}]);
	HTMLInputElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Accept", name: "Accept", embedded: false, exported: true, typ: $String, tag: "js:\"accept\""}, {prop: "Alt", name: "Alt", embedded: false, exported: true, typ: $String, tag: "js:\"alt\""}, {prop: "Autocomplete", name: "Autocomplete", embedded: false, exported: true, typ: $String, tag: "js:\"autocomplete\""}, {prop: "Autofocus", name: "Autofocus", embedded: false, exported: true, typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Checked", name: "Checked", embedded: false, exported: true, typ: $Bool, tag: "js:\"checked\""}, {prop: "DefaultChecked", name: "DefaultChecked", embedded: false, exported: true, typ: $Bool, tag: "js:\"defaultChecked\""}, {prop: "DefaultValue", name: "DefaultValue", embedded: false, exported: true, typ: $String, tag: "js:\"defaultValue\""}, {prop: "DirName", name: "DirName", embedded: false, exported: true, typ: $String, tag: "js:\"dirName\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "FormAction", name: "FormAction", embedded: false, exported: true, typ: $String, tag: "js:\"formAction\""}, {prop: "FormEncType", name: "FormEncType", embedded: false, exported: true, typ: $String, tag: "js:\"formEncType\""}, {prop: "FormMethod", name: "FormMethod", embedded: false, exported: true, typ: $String, tag: "js:\"formMethod\""}, {prop: "FormNoValidate", name: "FormNoValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"formNoValidate\""}, {prop: "FormTarget", name: "FormTarget", embedded: false, exported: true, typ: $String, tag: "js:\"formTarget\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $String, tag: "js:\"height\""}, {prop: "Indeterminate", name: "Indeterminate", embedded: false, exported: true, typ: $Bool, tag: "js:\"indeterminate\""}, {prop: "Max", name: "Max", embedded: false, exported: true, typ: $String, tag: "js:\"max\""}, {prop: "MaxLength", name: "MaxLength", embedded: false, exported: true, typ: $Int, tag: "js:\"maxLength\""}, {prop: "Min", name: "Min", embedded: false, exported: true, typ: $String, tag: "js:\"min\""}, {prop: "Multiple", name: "Multiple", embedded: false, exported: true, typ: $Bool, tag: "js:\"multiple\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Pattern", name: "Pattern", embedded: false, exported: true, typ: $String, tag: "js:\"pattern\""}, {prop: "Placeholder", name: "Placeholder", embedded: false, exported: true, typ: $String, tag: "js:\"placeholder\""}, {prop: "ReadOnly", name: "ReadOnly", embedded: false, exported: true, typ: $Bool, tag: "js:\"readOnly\""}, {prop: "Required", name: "Required", embedded: false, exported: true, typ: $Bool, tag: "js:\"required\""}, {prop: "SelectionDirection", name: "SelectionDirection", embedded: false, exported: true, typ: $String, tag: "js:\"selectionDirection\""}, {prop: "SelectionEnd", name: "SelectionEnd", embedded: false, exported: true, typ: $Int, tag: "js:\"selectionEnd\""}, {prop: "SelectionStart", name: "SelectionStart", embedded: false, exported: true, typ: $Int, tag: "js:\"selectionStart\""}, {prop: "Size", name: "Size", embedded: false, exported: true, typ: $Int, tag: "js:\"size\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "Step", name: "Step", embedded: false, exported: true, typ: $String, tag: "js:\"step\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}, {prop: "ValueAsDate", name: "ValueAsDate", embedded: false, exported: true, typ: time.Time, tag: "js:\"valueAsDate\""}, {prop: "ValueAsNumber", name: "ValueAsNumber", embedded: false, exported: true, typ: $Float64, tag: "js:\"valueAsNumber\""}, {prop: "Width", name: "Width", embedded: false, exported: true, typ: $String, tag: "js:\"width\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	File.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	HTMLKeygenElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Autofocus", name: "Autofocus", embedded: false, exported: true, typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Challenge", name: "Challenge", embedded: false, exported: true, typ: $String, tag: "js:\"challenge\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Keytype", name: "Keytype", embedded: false, exported: true, typ: $String, tag: "js:\"keytype\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLLIElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $Int, tag: "js:\"value\""}]);
	HTMLLabelElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "For", name: "For", embedded: false, exported: true, typ: $String, tag: "js:\"htmlFor\""}]);
	HTMLLegendElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLLinkElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Href", name: "Href", embedded: false, exported: true, typ: $String, tag: "js:\"href\""}, {prop: "HrefLang", name: "HrefLang", embedded: false, exported: true, typ: $String, tag: "js:\"hrefLang\""}, {prop: "Media", name: "Media", embedded: false, exported: true, typ: $String, tag: "js:\"media\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLMapElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}]);
	HTMLMediaElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Paused", name: "Paused", embedded: false, exported: true, typ: $Bool, tag: "js:\"paused\""}]);
	HTMLMenuElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLMetaElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Content", name: "Content", embedded: false, exported: true, typ: $String, tag: "js:\"content\""}, {prop: "HTTPEquiv", name: "HTTPEquiv", embedded: false, exported: true, typ: $String, tag: "js:\"httpEquiv\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}]);
	HTMLMeterElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "High", name: "High", embedded: false, exported: true, typ: $Float64, tag: "js:\"high\""}, {prop: "Low", name: "Low", embedded: false, exported: true, typ: $Float64, tag: "js:\"low\""}, {prop: "Max", name: "Max", embedded: false, exported: true, typ: $Float64, tag: "js:\"max\""}, {prop: "Min", name: "Min", embedded: false, exported: true, typ: $Float64, tag: "js:\"min\""}, {prop: "Optimum", name: "Optimum", embedded: false, exported: true, typ: $Float64, tag: "js:\"optimum\""}]);
	HTMLModElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Cite", name: "Cite", embedded: false, exported: true, typ: $String, tag: "js:\"cite\""}, {prop: "DateTime", name: "DateTime", embedded: false, exported: true, typ: $String, tag: "js:\"dateTime\""}]);
	HTMLOListElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Reversed", name: "Reversed", embedded: false, exported: true, typ: $Bool, tag: "js:\"reversed\""}, {prop: "Start", name: "Start", embedded: false, exported: true, typ: $Int, tag: "js:\"start\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLObjectElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Data", name: "Data", embedded: false, exported: true, typ: $String, tag: "js:\"data\""}, {prop: "Height", name: "Height", embedded: false, exported: true, typ: $String, tag: "js:\"height\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "TypeMustMatch", name: "TypeMustMatch", embedded: false, exported: true, typ: $Bool, tag: "js:\"typeMustMatch\""}, {prop: "UseMap", name: "UseMap", embedded: false, exported: true, typ: $String, tag: "js:\"useMap\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "With", name: "With", embedded: false, exported: true, typ: $String, tag: "js:\"with\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLOptGroupElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Label", name: "Label", embedded: false, exported: true, typ: $String, tag: "js:\"label\""}]);
	HTMLOptionElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "DefaultSelected", name: "DefaultSelected", embedded: false, exported: true, typ: $Bool, tag: "js:\"defaultSelected\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Index", name: "Index", embedded: false, exported: true, typ: $Int, tag: "js:\"index\""}, {prop: "Label", name: "Label", embedded: false, exported: true, typ: $String, tag: "js:\"label\""}, {prop: "Selected", name: "Selected", embedded: false, exported: true, typ: $Bool, tag: "js:\"selected\""}, {prop: "Text", name: "Text", embedded: false, exported: true, typ: $String, tag: "js:\"text\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}]);
	HTMLOutputElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "DefaultValue", name: "DefaultValue", embedded: false, exported: true, typ: $String, tag: "js:\"defaultValue\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLParagraphElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLParamElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}]);
	HTMLPreElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLProgressElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Max", name: "Max", embedded: false, exported: true, typ: $Float64, tag: "js:\"max\""}, {prop: "Position", name: "Position", embedded: false, exported: true, typ: $Float64, tag: "js:\"position\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $Float64, tag: "js:\"value\""}]);
	HTMLQuoteElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Cite", name: "Cite", embedded: false, exported: true, typ: $String, tag: "js:\"cite\""}]);
	HTMLScriptElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "Charset", name: "Charset", embedded: false, exported: true, typ: $String, tag: "js:\"charset\""}, {prop: "Async", name: "Async", embedded: false, exported: true, typ: $Bool, tag: "js:\"async\""}, {prop: "Defer", name: "Defer", embedded: false, exported: true, typ: $Bool, tag: "js:\"defer\""}, {prop: "Text", name: "Text", embedded: false, exported: true, typ: $String, tag: "js:\"text\""}]);
	HTMLSelectElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Autofocus", name: "Autofocus", embedded: false, exported: true, typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "Length", name: "Length", embedded: false, exported: true, typ: $Int, tag: "js:\"length\""}, {prop: "Multiple", name: "Multiple", embedded: false, exported: true, typ: $Bool, tag: "js:\"multiple\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Required", name: "Required", embedded: false, exported: true, typ: $Bool, tag: "js:\"required\""}, {prop: "SelectedIndex", name: "SelectedIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"selectedIndex\""}, {prop: "Size", name: "Size", embedded: false, exported: true, typ: $Int, tag: "js:\"size\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLSourceElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Media", name: "Media", embedded: false, exported: true, typ: $String, tag: "js:\"media\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}]);
	HTMLSpanElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLStyleElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTableCaptionElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTableCellElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "ColSpan", name: "ColSpan", embedded: false, exported: true, typ: $Int, tag: "js:\"colSpan\""}, {prop: "RowSpan", name: "RowSpan", embedded: false, exported: true, typ: $Int, tag: "js:\"rowSpan\""}, {prop: "CellIndex", name: "CellIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"cellIndex\""}]);
	HTMLTableColElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Span", name: "Span", embedded: false, exported: true, typ: $Int, tag: "js:\"span\""}]);
	HTMLTableDataCellElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTableElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTableHeaderCellElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Abbr", name: "Abbr", embedded: false, exported: true, typ: $String, tag: "js:\"abbr\""}, {prop: "Scope", name: "Scope", embedded: false, exported: true, typ: $String, tag: "js:\"scope\""}]);
	HTMLTableRowElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "RowIndex", name: "RowIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"rowIndex\""}, {prop: "SectionRowIndex", name: "SectionRowIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"sectionRowIndex\""}]);
	HTMLTableSectionElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTemplateElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLTextAreaElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Autocomplete", name: "Autocomplete", embedded: false, exported: true, typ: $String, tag: "js:\"autocomplete\""}, {prop: "Autofocus", name: "Autofocus", embedded: false, exported: true, typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Cols", name: "Cols", embedded: false, exported: true, typ: $Int, tag: "js:\"cols\""}, {prop: "DefaultValue", name: "DefaultValue", embedded: false, exported: true, typ: $String, tag: "js:\"defaultValue\""}, {prop: "DirName", name: "DirName", embedded: false, exported: true, typ: $String, tag: "js:\"dirName\""}, {prop: "Disabled", name: "Disabled", embedded: false, exported: true, typ: $Bool, tag: "js:\"disabled\""}, {prop: "MaxLength", name: "MaxLength", embedded: false, exported: true, typ: $Int, tag: "js:\"maxLength\""}, {prop: "Name", name: "Name", embedded: false, exported: true, typ: $String, tag: "js:\"name\""}, {prop: "Placeholder", name: "Placeholder", embedded: false, exported: true, typ: $String, tag: "js:\"placeholder\""}, {prop: "ReadOnly", name: "ReadOnly", embedded: false, exported: true, typ: $Bool, tag: "js:\"readOnly\""}, {prop: "Required", name: "Required", embedded: false, exported: true, typ: $Bool, tag: "js:\"required\""}, {prop: "Rows", name: "Rows", embedded: false, exported: true, typ: $Int, tag: "js:\"rows\""}, {prop: "SelectionDirection", name: "SelectionDirection", embedded: false, exported: true, typ: $String, tag: "js:\"selectionDirection\""}, {prop: "SelectionStart", name: "SelectionStart", embedded: false, exported: true, typ: $Int, tag: "js:\"selectionStart\""}, {prop: "SelectionEnd", name: "SelectionEnd", embedded: false, exported: true, typ: $Int, tag: "js:\"selectionEnd\""}, {prop: "TabIndex", name: "TabIndex", embedded: false, exported: true, typ: $Int, tag: "js:\"tabIndex\""}, {prop: "TextLength", name: "TextLength", embedded: false, exported: true, typ: $Int, tag: "js:\"textLength\""}, {prop: "Type", name: "Type", embedded: false, exported: true, typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", embedded: false, exported: true, typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", embedded: false, exported: true, typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", embedded: false, exported: true, typ: $Bool, tag: "js:\"willValidate\""}, {prop: "Wrap", name: "Wrap", embedded: false, exported: true, typ: $String, tag: "js:\"wrap\""}]);
	HTMLTimeElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "DateTime", name: "DateTime", embedded: false, exported: true, typ: $String, tag: "js:\"dateTime\""}]);
	HTMLTitleElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Text", name: "Text", embedded: false, exported: true, typ: $String, tag: "js:\"text\""}]);
	TextTrack.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	HTMLTrackElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}, {prop: "Kind", name: "Kind", embedded: false, exported: true, typ: $String, tag: "js:\"kind\""}, {prop: "Src", name: "Src", embedded: false, exported: true, typ: $String, tag: "js:\"src\""}, {prop: "Srclang", name: "Srclang", embedded: false, exported: true, typ: $String, tag: "js:\"srclang\""}, {prop: "Label", name: "Label", embedded: false, exported: true, typ: $String, tag: "js:\"label\""}, {prop: "Default", name: "Default", embedded: false, exported: true, typ: $Bool, tag: "js:\"default\""}, {prop: "ReadyState", name: "ReadyState", embedded: false, exported: true, typ: $Int, tag: "js:\"readyState\""}]);
	HTMLUListElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLUnknownElement.init("", [{prop: "BasicHTMLElement", name: "BasicHTMLElement", embedded: true, exported: true, typ: ptrType$1, tag: ""}]);
	HTMLVideoElement.init("", [{prop: "HTMLMediaElement", name: "HTMLMediaElement", embedded: true, exported: true, typ: ptrType$3, tag: ""}]);
	ValidityState.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "CustomError", name: "CustomError", embedded: false, exported: true, typ: $Bool, tag: "js:\"customError\""}, {prop: "PatternMismatch", name: "PatternMismatch", embedded: false, exported: true, typ: $Bool, tag: "js:\"patternMismatch\""}, {prop: "RangeOverflow", name: "RangeOverflow", embedded: false, exported: true, typ: $Bool, tag: "js:\"rangeOverflow\""}, {prop: "RangeUnderflow", name: "RangeUnderflow", embedded: false, exported: true, typ: $Bool, tag: "js:\"rangeUnderflow\""}, {prop: "StepMismatch", name: "StepMismatch", embedded: false, exported: true, typ: $Bool, tag: "js:\"stepMismatch\""}, {prop: "TooLong", name: "TooLong", embedded: false, exported: true, typ: $Bool, tag: "js:\"tooLong\""}, {prop: "TypeMismatch", name: "TypeMismatch", embedded: false, exported: true, typ: $Bool, tag: "js:\"typeMismatch\""}, {prop: "Valid", name: "Valid", embedded: false, exported: true, typ: $Bool, tag: "js:\"valid\""}, {prop: "ValueMissing", name: "ValueMissing", embedded: false, exported: true, typ: $Bool, tag: "js:\"valueMissing\""}]);
	CSSStyleDeclaration.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	Text.init("", [{prop: "BasicNode", name: "BasicNode", embedded: true, exported: true, typ: ptrType$25, tag: ""}]);
	Event.init([{prop: "Bubbles", name: "Bubbles", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Cancelable", name: "Cancelable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CurrentTarget", name: "CurrentTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DefaultPrevented", name: "DefaultPrevented", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "EventPhase", name: "EventPhase", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "PreventDefault", name: "PreventDefault", pkg: "", typ: $funcType([], [], false)}, {prop: "StopImmediatePropagation", name: "StopImmediatePropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "StopPropagation", name: "StopPropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Timestamp", name: "Timestamp", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	BasicEvent.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}]);
	AnimationEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	AudioProcessingEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	BeforeInputEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	BeforeUnloadEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	BlobEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	ClipboardEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	CloseEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}, {prop: "Code", name: "Code", embedded: false, exported: true, typ: $Int, tag: "js:\"code\""}, {prop: "Reason", name: "Reason", embedded: false, exported: true, typ: $String, tag: "js:\"reason\""}, {prop: "WasClean", name: "WasClean", embedded: false, exported: true, typ: $Bool, tag: "js:\"wasClean\""}]);
	CompositionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	CSSFontFaceLoadEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	CustomEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DeviceLightEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DeviceMotionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DeviceOrientationEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DeviceProximityEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DOMTransactionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	DragEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	EditingBeforeInputEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	ErrorEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	FocusEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	GamepadEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	HashChangeEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	IDBVersionChangeEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	KeyboardEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}, {prop: "AltKey", name: "AltKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"altKey\""}, {prop: "CharCode", name: "CharCode", embedded: false, exported: true, typ: $Int, tag: "js:\"charCode\""}, {prop: "CtrlKey", name: "CtrlKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"ctrlKey\""}, {prop: "Key", name: "Key", embedded: false, exported: true, typ: $String, tag: "js:\"key\""}, {prop: "KeyIdentifier", name: "KeyIdentifier", embedded: false, exported: true, typ: $String, tag: "js:\"keyIdentifier\""}, {prop: "KeyCode", name: "KeyCode", embedded: false, exported: true, typ: $Int, tag: "js:\"keyCode\""}, {prop: "Locale", name: "Locale", embedded: false, exported: true, typ: $String, tag: "js:\"locale\""}, {prop: "Location", name: "Location", embedded: false, exported: true, typ: $Int, tag: "js:\"location\""}, {prop: "KeyLocation", name: "KeyLocation", embedded: false, exported: true, typ: $Int, tag: "js:\"keyLocation\""}, {prop: "MetaKey", name: "MetaKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"metaKey\""}, {prop: "Repeat", name: "Repeat", embedded: false, exported: true, typ: $Bool, tag: "js:\"repeat\""}, {prop: "ShiftKey", name: "ShiftKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"shiftKey\""}]);
	MediaStreamEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	MessageEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}, {prop: "Data", name: "Data", embedded: false, exported: true, typ: ptrType, tag: "js:\"data\""}]);
	MouseEvent.init("", [{prop: "UIEvent", name: "UIEvent", embedded: true, exported: true, typ: ptrType$20, tag: ""}, {prop: "AltKey", name: "AltKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"altKey\""}, {prop: "Button", name: "Button", embedded: false, exported: true, typ: $Int, tag: "js:\"button\""}, {prop: "ClientX", name: "ClientX", embedded: false, exported: true, typ: $Int, tag: "js:\"clientX\""}, {prop: "ClientY", name: "ClientY", embedded: false, exported: true, typ: $Int, tag: "js:\"clientY\""}, {prop: "CtrlKey", name: "CtrlKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"ctrlKey\""}, {prop: "MetaKey", name: "MetaKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"metaKey\""}, {prop: "MovementX", name: "MovementX", embedded: false, exported: true, typ: $Int, tag: "js:\"movementX\""}, {prop: "MovementY", name: "MovementY", embedded: false, exported: true, typ: $Int, tag: "js:\"movementY\""}, {prop: "ScreenX", name: "ScreenX", embedded: false, exported: true, typ: $Int, tag: "js:\"screenX\""}, {prop: "ScreenY", name: "ScreenY", embedded: false, exported: true, typ: $Int, tag: "js:\"screenY\""}, {prop: "ShiftKey", name: "ShiftKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"shiftKey\""}]);
	MutationEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	OfflineAudioCompletionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	PageTransitionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	PointerEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	PopStateEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	ProgressEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	RelatedEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	RTCPeerConnectionIceEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	SensorEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	StorageEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	SVGEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	SVGZoomEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	TimeEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	TouchEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}, {prop: "AltKey", name: "AltKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"altKey\""}, {prop: "CtrlKey", name: "CtrlKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"ctrlKey\""}, {prop: "MetaKey", name: "MetaKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"metaKey\""}, {prop: "ShiftKey", name: "ShiftKey", embedded: false, exported: true, typ: $Bool, tag: "js:\"shiftKey\""}]);
	Touch.init("", [{prop: "Object", name: "Object", embedded: true, exported: true, typ: ptrType, tag: ""}, {prop: "Identifier", name: "Identifier", embedded: false, exported: true, typ: $Int, tag: "js:\"identifier\""}, {prop: "ScreenX", name: "ScreenX", embedded: false, exported: true, typ: $Float64, tag: "js:\"screenX\""}, {prop: "ScreenY", name: "ScreenY", embedded: false, exported: true, typ: $Float64, tag: "js:\"screenY\""}, {prop: "ClientX", name: "ClientX", embedded: false, exported: true, typ: $Float64, tag: "js:\"clientX\""}, {prop: "ClientY", name: "ClientY", embedded: false, exported: true, typ: $Float64, tag: "js:\"clientY\""}, {prop: "PageX", name: "PageX", embedded: false, exported: true, typ: $Float64, tag: "js:\"pageX\""}, {prop: "PageY", name: "PageY", embedded: false, exported: true, typ: $Float64, tag: "js:\"pageY\""}, {prop: "RadiusX", name: "RadiusX", embedded: false, exported: true, typ: $Float64, tag: "js:\"radiusX\""}, {prop: "RadiusY", name: "RadiusY", embedded: false, exported: true, typ: $Float64, tag: "js:\"radiusY\""}, {prop: "RotationAngle", name: "RotationAngle", embedded: false, exported: true, typ: $Float64, tag: "js:\"rotationAngle\""}, {prop: "Force", name: "Force", embedded: false, exported: true, typ: $Float64, tag: "js:\"force\""}]);
	TrackEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	TransitionEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	UIEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	UserProximityEvent.init("", [{prop: "BasicEvent", name: "BasicEvent", embedded: true, exported: true, typ: ptrType$19, tag: ""}]);
	WheelEvent.init("", [{prop: "MouseEvent", name: "MouseEvent", embedded: true, exported: true, typ: ptrType$21, tag: ""}, {prop: "DeltaX", name: "DeltaX", embedded: false, exported: true, typ: $Float64, tag: "js:\"deltaX\""}, {prop: "DeltaY", name: "DeltaY", embedded: false, exported: true, typ: $Float64, tag: "js:\"deltaY\""}, {prop: "DeltaZ", name: "DeltaZ", embedded: false, exported: true, typ: $Float64, tag: "js:\"deltaZ\""}, {prop: "DeltaMode", name: "DeltaMode", embedded: false, exported: true, typ: $Int, tag: "js:\"deltaMode\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = image.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = color.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, dom, strconv, sliceType, ptrType, ptrType$1, blockChars, openStates, ch, source, current, peeked, hNum, lastState, pushState, remLastState, next, curr, peek, peek2, compile, convert, main;
	dom = $packages["honnef.co/go/js/dom"];
	strconv = $packages["strconv"];
	sliceType = $sliceType($Int);
	ptrType = $ptrType(dom.HTMLTextAreaElement);
	ptrType$1 = $ptrType(dom.HTMLIFrameElement);
	lastState = function() {
		var x;
		return (x = openStates.$length - 1 >> 0, ((x < 0 || x >= openStates.$length) ? ($throwRuntimeError("index out of range"), undefined) : openStates.$array[openStates.$offset + x]));
	};
	pushState = function(state) {
		var state;
		openStates = $append(openStates, state);
	};
	remLastState = function() {
		openStates = $subslice(openStates, 0, (openStates.$length - 1 >> 0));
	};
	next = function() {
		current = current + (1) >> 0;
		peeked = peeked + (1) >> 0;
	};
	curr = function() {
		return source.charCodeAt(current);
	};
	peek = function() {
		return source.charCodeAt(peeked);
	};
	peek2 = function() {
		return source.charCodeAt((peeked + 1 >> 0));
	};
	compile = function(src) {
		var _1, _entry, _entry$1, _entry$10, _entry$11, _entry$12, _entry$13, _entry$14, _entry$15, _entry$16, _entry$17, _entry$18, _entry$19, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, alt, alt$1, compiled, h, paropen, paropen$1, src, url, url$1, w;
		source = src;
		compiled = "";
		while (true) {
			if (!(current < source.length)) { break; }
			ch = curr();
			_1 = ch;
			if (_1 === ((_entry = blockChars[$String.keyFor("esc")], _entry !== undefined ? _entry.v : 0))) {
				next();
				ch = curr();
				compiled = compiled + (($encodeRune(ch)));
			} else if (_1 === ((_entry$1 = blockChars[$String.keyFor("escapeBegin")], _entry$1 !== undefined ? _entry$1.v : 0))) {
				next();
				ch = curr();
				while (true) {
					if (!(!((ch === (_entry$11 = blockChars[$String.keyFor("escapeEnd")], _entry$11 !== undefined ? _entry$11.v : 0))) && current < source.length)) { break; }
					if (ch === (_entry$12 = blockChars[$String.keyFor("esc")], _entry$12 !== undefined ? _entry$12.v : 0)) {
						next();
						ch = curr();
					}
					compiled = compiled + (($encodeRune(ch)));
					next();
					ch = curr();
					if (ch === (_entry$13 = blockChars[$String.keyFor("escapeEnd")], _entry$13 !== undefined ? _entry$13.v : 0)) {
						break;
					}
				}
			} else if (_1 === ((_entry$2 = blockChars[$String.keyFor("bold")], _entry$2 !== undefined ? _entry$2.v : 0))) {
				if (openStates.$length > 0 && (lastState() === 2)) {
					compiled = compiled + ("</strong>");
					remLastState();
				} else {
					compiled = compiled + ("<strong>");
					pushState(2);
				}
			} else if (_1 === ((_entry$3 = blockChars[$String.keyFor("italics")], _entry$3 !== undefined ? _entry$3.v : 0))) {
				if (openStates.$length > 0 && (lastState() === 3)) {
					compiled = compiled + ("</em>");
					remLastState();
				} else {
					compiled = compiled + ("<em>");
					pushState(3);
				}
			} else if (_1 === ((_entry$4 = blockChars[$String.keyFor("underline")], _entry$4 !== undefined ? _entry$4.v : 0))) {
				if (openStates.$length > 0 && (lastState() === 4)) {
					compiled = compiled + ("</u>");
					remLastState();
				} else {
					compiled = compiled + ("<u>");
					pushState(4);
				}
			} else if (_1 === ((_entry$5 = blockChars[$String.keyFor("line")], _entry$5 !== undefined ? _entry$5.v : 0))) {
				if ((peek() === (_entry$14 = blockChars[$String.keyFor("line")], _entry$14 !== undefined ? _entry$14.v : 0)) && (peek2() === (_entry$15 = blockChars[$String.keyFor("line")], _entry$15 !== undefined ? _entry$15.v : 0))) {
					if (openStates.$length === 0) {
						next();
						next();
						ch = curr();
						compiled = compiled + ("<hr>");
					} else {
						compiled = compiled + (($encodeRune(ch)));
					}
				} else {
					compiled = compiled + (($encodeRune(ch)));
				}
			} else if (_1 === ((_entry$6 = blockChars[$String.keyFor("newline")], _entry$6 !== undefined ? _entry$6.v : 0))) {
				if (peek() === (_entry$16 = blockChars[$String.keyFor("newline")], _entry$16 !== undefined ? _entry$16.v : 0)) {
					next();
					compiled = compiled + ("<br>");
				} else {
					compiled = compiled + (($encodeRune(ch)));
				}
			} else if (_1 === ((_entry$7 = blockChars[$String.keyFor("heading")], _entry$7 !== undefined ? _entry$7.v : 0))) {
				hNum = 1;
				next();
				ch = curr();
				while (true) {
					if (!(ch === 35)) { break; }
					hNum = hNum + (1) >> 0;
					next();
					ch = curr();
					if (hNum === 6) {
						break;
					}
				}
				current = current - (1) >> 0;
				peeked = peeked - (1) >> 0;
				compiled = compiled + ("<h" + strconv.Itoa(hNum) + ">");
				pushState(10);
			} else if (_1 === (10)) {
				if (openStates.$length > 0 && (lastState() === 10)) {
					remLastState();
					compiled = compiled + ("</h" + strconv.Itoa(hNum) + ">");
					hNum = 0;
				} else {
					compiled = compiled + ("<br>");
				}
			} else if (_1 === ((_entry$8 = blockChars[$String.keyFor("link")], _entry$8 !== undefined ? _entry$8.v : 0))) {
				next();
				ch = curr();
				if (ch === 91) {
					compiled = compiled + ("\n<a href=\"");
					url = "";
					alt = "";
					next();
					ch = curr();
					while (true) {
						if (!(!((ch === 93)) && current < source.length)) { break; }
						alt = alt + (($encodeRune(ch)));
						next();
						ch = curr();
					}
					next();
					ch = curr();
					if (!((ch === 40))) {
						return "";
					}
					next();
					ch = curr();
					paropen = 0;
					while (true) {
						if (!(!((ch === 41)) && current < source.length)) { break; }
						if (ch === 40) {
							paropen = paropen + (1) >> 0;
						}
						url = url + (($encodeRune(ch)));
						next();
						ch = curr();
						while (true) {
							if (!((ch === 41) && !((paropen === 0)))) { break; }
							url = url + (($encodeRune(ch)));
							next();
							ch = curr();
							paropen = paropen - (1) >> 0;
						}
					}
					next();
					ch = curr();
					compiled = compiled + (url);
					compiled = compiled + ("\">");
					if (alt === "") {
						compiled = compiled + (url);
					} else {
						compiled = compiled + (alt);
					}
					compiled = compiled + ("</a>\n");
				}
			} else if (_1 === ((_entry$9 = blockChars[$String.keyFor("image")], _entry$9 !== undefined ? _entry$9.v : 0))) {
				next();
				ch = curr();
				if (ch === 91) {
					compiled = compiled + ("\n<img src=\"");
					url$1 = "";
					alt$1 = "";
					w = "";
					h = "";
					next();
					ch = curr();
					while (true) {
						if (!(!((ch === 93)) && current < source.length)) { break; }
						if ((ch === 58) && (peek() === 58)) {
							next();
							next();
							ch = curr();
							while (true) {
								if (!(!((ch === 58)) || !((peek() === 58)))) { break; }
								w = w + (($encodeRune(ch)));
								next();
								ch = curr();
							}
							next();
							next();
							ch = curr();
							while (true) {
								if (!(!((ch === 93)) && current < source.length)) { break; }
								h = h + (($encodeRune(ch)));
								next();
								ch = curr();
							}
							break;
						}
						alt$1 = alt$1 + (($encodeRune(ch)));
						next();
						ch = curr();
					}
					next();
					ch = curr();
					if (!((ch === 40))) {
						return "";
					}
					next();
					ch = curr();
					paropen$1 = 0;
					while (true) {
						if (!(!((ch === 41)) && current < source.length)) { break; }
						if (ch === 40) {
							paropen$1 = paropen$1 + (1) >> 0;
						}
						url$1 = url$1 + (($encodeRune(ch)));
						next();
						ch = curr();
						while (true) {
							if (!((ch === 41) && !((paropen$1 === 0)))) { break; }
							url$1 = url$1 + (($encodeRune(ch)));
							next();
							ch = curr();
							paropen$1 = paropen$1 - (1) >> 0;
						}
					}
					next();
					ch = curr();
					compiled = compiled + (url$1);
					compiled = compiled + ("\" alt=\"");
					if (alt$1 === "") {
						compiled = compiled + (url$1);
					} else {
						compiled = compiled + (alt$1);
					}
					compiled = compiled + ("\"");
					if (!(w === "")) {
						compiled = compiled + (" width=\"");
						compiled = compiled + (w);
						compiled = compiled + ("\"");
					}
					if (!(h === "")) {
						compiled = compiled + (" height=\"");
						compiled = compiled + (h);
						compiled = compiled + ("\"");
					}
					compiled = compiled + (">\n");
				}
			} else if (_1 === ((_entry$10 = blockChars[$String.keyFor("code")], _entry$10 !== undefined ? _entry$10.v : 0))) {
				next();
				ch = curr();
				compiled = compiled + ("<pre>");
				while (true) {
					if (!(!((ch === (_entry$17 = blockChars[$String.keyFor("code")], _entry$17 !== undefined ? _entry$17.v : 0))) && current < source.length)) { break; }
					if (ch === (_entry$18 = blockChars[$String.keyFor("esc")], _entry$18 !== undefined ? _entry$18.v : 0)) {
						next();
						ch = curr();
						compiled = compiled + (($encodeRune(ch)));
						next();
						ch = curr();
					}
					compiled = compiled + (($encodeRune(ch)));
					next();
					ch = curr();
					if ((ch === (_entry$19 = blockChars[$String.keyFor("code")], _entry$19 !== undefined ? _entry$19.v : 0)) || current >= source.length) {
						break;
					}
				}
				compiled = compiled + ("</pre>");
			} else {
				compiled = compiled + (($encodeRune(ch)));
			}
			next();
		}
		source = "";
		current = 0;
		peeked = 1;
		return compiled;
	};
	convert = function(input) {
		var htmlBeg, htmlEnd, input, output;
		htmlBeg = "\n<!doctype HTML>\n<html>\n<head>\n<link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n<div id=\"content\">\n";
		htmlEnd = "\n</div>\n</body>\n</html>\n";
		output = htmlBeg + compile(input) + htmlEnd;
		return output;
	};
	main = function() {
		var _r, _r$1, _r$2, b, d, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = [d];
		_r = dom.GetWindow().Document(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		d[0] = _r;
		_r$1 = d[0].GetElementByID("but"); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		_r$2 = b.AddEventListener("click", false, (function(d) { return function $b(event) {
			var _r$2, _r$3, event, o, ta, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; event = $f.event; o = $f.o; ta = $f.ta; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$2 = d[0].GetElementByID("ta"); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			ta = $assertType(_r$2, ptrType);
			_r$3 = d[0].GetElementByID("output"); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			o = $assertType(_r$3, ptrType$1);
			o.BasicHTMLElement.BasicElement.BasicNode.Object.srcdoc = $externalize(convert($internalize(ta.BasicHTMLElement.BasicElement.BasicNode.Object.value, $String)), $String);
			$s = -1; return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f.event = event; $f.o = o; $f.ta = ta; $f.$s = $s; $f.$r = $r; return $f;
		}; })(d)); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_r$2;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: main }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = dom.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		openStates = sliceType.nil;
		ch = 0;
		source = "";
		hNum = 0;
		blockChars = $makeMap($String.keyFor, [{ k: "esc", v: 92 }, { k: "escapeBegin", v: 123 }, { k: "escapeEnd", v: 125 }, { k: "bold", v: 42 }, { k: "italics", v: 47 }, { k: "underline", v: 95 }, { k: "line", v: 45 }, { k: "newline", v: 59 }, { k: "link", v: 64 }, { k: "image", v: 33 }, { k: "code", v: 96 }, { k: "heading", v: 35 }]);
		current = 0;
		peeked = 1;
		/* */ if ($pkg === $mainPkg) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if ($pkg === $mainPkg) { */ case 3:
			$r = main(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$mainFinished = true;
		/* } */ case 4:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, []);
$flushConsole();

}).call(this);
//# sourceMappingURL=main.js.map
