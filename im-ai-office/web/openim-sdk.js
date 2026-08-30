(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // node_modules/loglevel/lib/loglevel.js
  var require_loglevel = __commonJS({
    "node_modules/loglevel/lib/loglevel.js"(exports, module) {
      (function(root, definition) {
        "use strict";
        if (typeof define === "function" && define.amd) {
          define(definition);
        } else if (typeof module === "object" && module.exports) {
          module.exports = definition();
        } else {
          root.log = definition();
        }
      })(exports, function() {
        "use strict";
        var noop = function() {
        };
        var undefinedType = "undefined";
        var isIE = typeof window !== undefinedType && typeof window.navigator !== undefinedType && /Trident\/|MSIE /.test(window.navigator.userAgent);
        var logMethods = [
          "trace",
          "debug",
          "info",
          "warn",
          "error"
        ];
        var _loggersByName = {};
        var defaultLogger = null;
        function bindMethod(obj, methodName) {
          var method = obj[methodName];
          if (typeof method.bind === "function") {
            return method.bind(obj);
          } else {
            try {
              return Function.prototype.bind.call(method, obj);
            } catch (e) {
              return function() {
                return Function.prototype.apply.apply(method, [obj, arguments]);
              };
            }
          }
        }
        function traceForIE() {
          if (console.log) {
            if (console.log.apply) {
              console.log.apply(console, arguments);
            } else {
              Function.prototype.apply.apply(console.log, [console, arguments]);
            }
          }
          if (console.trace) console.trace();
        }
        function realMethod(methodName) {
          if (methodName === "debug") {
            methodName = "log";
          }
          if (typeof console === undefinedType) {
            return false;
          } else if (methodName === "trace" && isIE) {
            return traceForIE;
          } else if (console[methodName] !== void 0) {
            return bindMethod(console, methodName);
          } else if (console.log !== void 0) {
            return bindMethod(console, "log");
          } else {
            return noop;
          }
        }
        function replaceLoggingMethods() {
          var level = this.getLevel();
          for (var i = 0; i < logMethods.length; i++) {
            var methodName = logMethods[i];
            this[methodName] = i < level ? noop : this.methodFactory(methodName, level, this.name);
          }
          this.log = this.debug;
          if (typeof console === undefinedType && level < this.levels.SILENT) {
            return "No console available for logging";
          }
        }
        function enableLoggingWhenConsoleArrives(methodName) {
          return function() {
            if (typeof console !== undefinedType) {
              replaceLoggingMethods.call(this);
              this[methodName].apply(this, arguments);
            }
          };
        }
        function defaultMethodFactory(methodName, _level, _loggerName) {
          return realMethod(methodName) || enableLoggingWhenConsoleArrives.apply(this, arguments);
        }
        function Logger(name, factory) {
          var self2 = this;
          var inheritedLevel;
          var defaultLevel;
          var userLevel;
          var storageKey = "loglevel";
          if (typeof name === "string") {
            storageKey += ":" + name;
          } else if (typeof name === "symbol") {
            storageKey = void 0;
          }
          function persistLevelIfPossible(levelNum) {
            var levelName = (logMethods[levelNum] || "silent").toUpperCase();
            if (typeof window === undefinedType || !storageKey) return;
            try {
              window.localStorage[storageKey] = levelName;
              return;
            } catch (ignore) {
            }
            try {
              window.document.cookie = encodeURIComponent(storageKey) + "=" + levelName + ";";
            } catch (ignore) {
            }
          }
          function getPersistedLevel() {
            var storedLevel;
            if (typeof window === undefinedType || !storageKey) return;
            try {
              storedLevel = window.localStorage[storageKey];
            } catch (ignore) {
            }
            if (typeof storedLevel === undefinedType) {
              try {
                var cookie = window.document.cookie;
                var cookieName = encodeURIComponent(storageKey);
                var location = cookie.indexOf(cookieName + "=");
                if (location !== -1) {
                  storedLevel = /^([^;]+)/.exec(
                    cookie.slice(location + cookieName.length + 1)
                  )[1];
                }
              } catch (ignore) {
              }
            }
            if (self2.levels[storedLevel] === void 0) {
              storedLevel = void 0;
            }
            return storedLevel;
          }
          function clearPersistedLevel() {
            if (typeof window === undefinedType || !storageKey) return;
            try {
              window.localStorage.removeItem(storageKey);
            } catch (ignore) {
            }
            try {
              window.document.cookie = encodeURIComponent(storageKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC";
            } catch (ignore) {
            }
          }
          function normalizeLevel(input) {
            var level = input;
            if (typeof level === "string" && self2.levels[level.toUpperCase()] !== void 0) {
              level = self2.levels[level.toUpperCase()];
            }
            if (typeof level === "number" && level >= 0 && level <= self2.levels.SILENT) {
              return level;
            } else {
              throw new TypeError("log.setLevel() called with invalid level: " + input);
            }
          }
          self2.name = name;
          self2.levels = {
            "TRACE": 0,
            "DEBUG": 1,
            "INFO": 2,
            "WARN": 3,
            "ERROR": 4,
            "SILENT": 5
          };
          self2.methodFactory = factory || defaultMethodFactory;
          self2.getLevel = function() {
            if (userLevel != null) {
              return userLevel;
            } else if (defaultLevel != null) {
              return defaultLevel;
            } else {
              return inheritedLevel;
            }
          };
          self2.setLevel = function(level, persist) {
            userLevel = normalizeLevel(level);
            if (persist !== false) {
              persistLevelIfPossible(userLevel);
            }
            return replaceLoggingMethods.call(self2);
          };
          self2.setDefaultLevel = function(level) {
            defaultLevel = normalizeLevel(level);
            if (!getPersistedLevel()) {
              self2.setLevel(level, false);
            }
          };
          self2.resetLevel = function() {
            userLevel = null;
            clearPersistedLevel();
            replaceLoggingMethods.call(self2);
          };
          self2.enableAll = function(persist) {
            self2.setLevel(self2.levels.TRACE, persist);
          };
          self2.disableAll = function(persist) {
            self2.setLevel(self2.levels.SILENT, persist);
          };
          self2.rebuild = function() {
            if (defaultLogger !== self2) {
              inheritedLevel = normalizeLevel(defaultLogger.getLevel());
            }
            replaceLoggingMethods.call(self2);
            if (defaultLogger === self2) {
              for (var childName in _loggersByName) {
                _loggersByName[childName].rebuild();
              }
            }
          };
          inheritedLevel = normalizeLevel(
            defaultLogger ? defaultLogger.getLevel() : "WARN"
          );
          var initialLevel = getPersistedLevel();
          if (initialLevel != null) {
            userLevel = normalizeLevel(initialLevel);
          }
          replaceLoggingMethods.call(self2);
        }
        defaultLogger = new Logger();
        defaultLogger.getLogger = function getLogger(name) {
          if (typeof name !== "symbol" && typeof name !== "string" || name === "") {
            throw new TypeError("You must supply a name when creating a logger.");
          }
          var logger = _loggersByName[name];
          if (!logger) {
            logger = _loggersByName[name] = new Logger(
              name,
              defaultLogger.methodFactory
            );
          }
          return logger;
        };
        var _log = typeof window !== undefinedType ? window.log : void 0;
        defaultLogger.noConflict = function() {
          if (typeof window !== undefinedType && window.log === defaultLogger) {
            window.log = _log;
          }
          return defaultLogger;
        };
        defaultLogger.getLoggers = function getLoggers() {
          return _loggersByName;
        };
        defaultLogger["default"] = defaultLogger;
        return defaultLogger;
      });
    }
  });

  // node_modules/spark-md5/spark-md5.js
  var require_spark_md5 = __commonJS({
    "node_modules/spark-md5/spark-md5.js"(exports, module) {
      (function(factory) {
        if (typeof exports === "object") {
          module.exports = factory();
        } else if (typeof define === "function" && define.amd) {
          define(factory);
        } else {
          var glob;
          try {
            glob = window;
          } catch (e) {
            glob = self;
          }
          glob.SparkMD5 = factory();
        }
      })(function(undefined2) {
        "use strict";
        var add32 = function(a, b) {
          return a + b & 4294967295;
        }, hex_chr = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
        function cmn(q, a, b, x, s, t) {
          a = add32(add32(a, q), add32(x, t));
          return add32(a << s | a >>> 32 - s, b);
        }
        function md5cycle(x, k) {
          var a = x[0], b = x[1], c = x[2], d = x[3];
          a += (b & c | ~b & d) + k[0] - 680876936 | 0;
          a = (a << 7 | a >>> 25) + b | 0;
          d += (a & b | ~a & c) + k[1] - 389564586 | 0;
          d = (d << 12 | d >>> 20) + a | 0;
          c += (d & a | ~d & b) + k[2] + 606105819 | 0;
          c = (c << 17 | c >>> 15) + d | 0;
          b += (c & d | ~c & a) + k[3] - 1044525330 | 0;
          b = (b << 22 | b >>> 10) + c | 0;
          a += (b & c | ~b & d) + k[4] - 176418897 | 0;
          a = (a << 7 | a >>> 25) + b | 0;
          d += (a & b | ~a & c) + k[5] + 1200080426 | 0;
          d = (d << 12 | d >>> 20) + a | 0;
          c += (d & a | ~d & b) + k[6] - 1473231341 | 0;
          c = (c << 17 | c >>> 15) + d | 0;
          b += (c & d | ~c & a) + k[7] - 45705983 | 0;
          b = (b << 22 | b >>> 10) + c | 0;
          a += (b & c | ~b & d) + k[8] + 1770035416 | 0;
          a = (a << 7 | a >>> 25) + b | 0;
          d += (a & b | ~a & c) + k[9] - 1958414417 | 0;
          d = (d << 12 | d >>> 20) + a | 0;
          c += (d & a | ~d & b) + k[10] - 42063 | 0;
          c = (c << 17 | c >>> 15) + d | 0;
          b += (c & d | ~c & a) + k[11] - 1990404162 | 0;
          b = (b << 22 | b >>> 10) + c | 0;
          a += (b & c | ~b & d) + k[12] + 1804603682 | 0;
          a = (a << 7 | a >>> 25) + b | 0;
          d += (a & b | ~a & c) + k[13] - 40341101 | 0;
          d = (d << 12 | d >>> 20) + a | 0;
          c += (d & a | ~d & b) + k[14] - 1502002290 | 0;
          c = (c << 17 | c >>> 15) + d | 0;
          b += (c & d | ~c & a) + k[15] + 1236535329 | 0;
          b = (b << 22 | b >>> 10) + c | 0;
          a += (b & d | c & ~d) + k[1] - 165796510 | 0;
          a = (a << 5 | a >>> 27) + b | 0;
          d += (a & c | b & ~c) + k[6] - 1069501632 | 0;
          d = (d << 9 | d >>> 23) + a | 0;
          c += (d & b | a & ~b) + k[11] + 643717713 | 0;
          c = (c << 14 | c >>> 18) + d | 0;
          b += (c & a | d & ~a) + k[0] - 373897302 | 0;
          b = (b << 20 | b >>> 12) + c | 0;
          a += (b & d | c & ~d) + k[5] - 701558691 | 0;
          a = (a << 5 | a >>> 27) + b | 0;
          d += (a & c | b & ~c) + k[10] + 38016083 | 0;
          d = (d << 9 | d >>> 23) + a | 0;
          c += (d & b | a & ~b) + k[15] - 660478335 | 0;
          c = (c << 14 | c >>> 18) + d | 0;
          b += (c & a | d & ~a) + k[4] - 405537848 | 0;
          b = (b << 20 | b >>> 12) + c | 0;
          a += (b & d | c & ~d) + k[9] + 568446438 | 0;
          a = (a << 5 | a >>> 27) + b | 0;
          d += (a & c | b & ~c) + k[14] - 1019803690 | 0;
          d = (d << 9 | d >>> 23) + a | 0;
          c += (d & b | a & ~b) + k[3] - 187363961 | 0;
          c = (c << 14 | c >>> 18) + d | 0;
          b += (c & a | d & ~a) + k[8] + 1163531501 | 0;
          b = (b << 20 | b >>> 12) + c | 0;
          a += (b & d | c & ~d) + k[13] - 1444681467 | 0;
          a = (a << 5 | a >>> 27) + b | 0;
          d += (a & c | b & ~c) + k[2] - 51403784 | 0;
          d = (d << 9 | d >>> 23) + a | 0;
          c += (d & b | a & ~b) + k[7] + 1735328473 | 0;
          c = (c << 14 | c >>> 18) + d | 0;
          b += (c & a | d & ~a) + k[12] - 1926607734 | 0;
          b = (b << 20 | b >>> 12) + c | 0;
          a += (b ^ c ^ d) + k[5] - 378558 | 0;
          a = (a << 4 | a >>> 28) + b | 0;
          d += (a ^ b ^ c) + k[8] - 2022574463 | 0;
          d = (d << 11 | d >>> 21) + a | 0;
          c += (d ^ a ^ b) + k[11] + 1839030562 | 0;
          c = (c << 16 | c >>> 16) + d | 0;
          b += (c ^ d ^ a) + k[14] - 35309556 | 0;
          b = (b << 23 | b >>> 9) + c | 0;
          a += (b ^ c ^ d) + k[1] - 1530992060 | 0;
          a = (a << 4 | a >>> 28) + b | 0;
          d += (a ^ b ^ c) + k[4] + 1272893353 | 0;
          d = (d << 11 | d >>> 21) + a | 0;
          c += (d ^ a ^ b) + k[7] - 155497632 | 0;
          c = (c << 16 | c >>> 16) + d | 0;
          b += (c ^ d ^ a) + k[10] - 1094730640 | 0;
          b = (b << 23 | b >>> 9) + c | 0;
          a += (b ^ c ^ d) + k[13] + 681279174 | 0;
          a = (a << 4 | a >>> 28) + b | 0;
          d += (a ^ b ^ c) + k[0] - 358537222 | 0;
          d = (d << 11 | d >>> 21) + a | 0;
          c += (d ^ a ^ b) + k[3] - 722521979 | 0;
          c = (c << 16 | c >>> 16) + d | 0;
          b += (c ^ d ^ a) + k[6] + 76029189 | 0;
          b = (b << 23 | b >>> 9) + c | 0;
          a += (b ^ c ^ d) + k[9] - 640364487 | 0;
          a = (a << 4 | a >>> 28) + b | 0;
          d += (a ^ b ^ c) + k[12] - 421815835 | 0;
          d = (d << 11 | d >>> 21) + a | 0;
          c += (d ^ a ^ b) + k[15] + 530742520 | 0;
          c = (c << 16 | c >>> 16) + d | 0;
          b += (c ^ d ^ a) + k[2] - 995338651 | 0;
          b = (b << 23 | b >>> 9) + c | 0;
          a += (c ^ (b | ~d)) + k[0] - 198630844 | 0;
          a = (a << 6 | a >>> 26) + b | 0;
          d += (b ^ (a | ~c)) + k[7] + 1126891415 | 0;
          d = (d << 10 | d >>> 22) + a | 0;
          c += (a ^ (d | ~b)) + k[14] - 1416354905 | 0;
          c = (c << 15 | c >>> 17) + d | 0;
          b += (d ^ (c | ~a)) + k[5] - 57434055 | 0;
          b = (b << 21 | b >>> 11) + c | 0;
          a += (c ^ (b | ~d)) + k[12] + 1700485571 | 0;
          a = (a << 6 | a >>> 26) + b | 0;
          d += (b ^ (a | ~c)) + k[3] - 1894986606 | 0;
          d = (d << 10 | d >>> 22) + a | 0;
          c += (a ^ (d | ~b)) + k[10] - 1051523 | 0;
          c = (c << 15 | c >>> 17) + d | 0;
          b += (d ^ (c | ~a)) + k[1] - 2054922799 | 0;
          b = (b << 21 | b >>> 11) + c | 0;
          a += (c ^ (b | ~d)) + k[8] + 1873313359 | 0;
          a = (a << 6 | a >>> 26) + b | 0;
          d += (b ^ (a | ~c)) + k[15] - 30611744 | 0;
          d = (d << 10 | d >>> 22) + a | 0;
          c += (a ^ (d | ~b)) + k[6] - 1560198380 | 0;
          c = (c << 15 | c >>> 17) + d | 0;
          b += (d ^ (c | ~a)) + k[13] + 1309151649 | 0;
          b = (b << 21 | b >>> 11) + c | 0;
          a += (c ^ (b | ~d)) + k[4] - 145523070 | 0;
          a = (a << 6 | a >>> 26) + b | 0;
          d += (b ^ (a | ~c)) + k[11] - 1120210379 | 0;
          d = (d << 10 | d >>> 22) + a | 0;
          c += (a ^ (d | ~b)) + k[2] + 718787259 | 0;
          c = (c << 15 | c >>> 17) + d | 0;
          b += (d ^ (c | ~a)) + k[9] - 343485551 | 0;
          b = (b << 21 | b >>> 11) + c | 0;
          x[0] = a + x[0] | 0;
          x[1] = b + x[1] | 0;
          x[2] = c + x[2] | 0;
          x[3] = d + x[3] | 0;
        }
        function md5blk(s) {
          var md5blks = [], i;
          for (i = 0; i < 64; i += 4) {
            md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
          }
          return md5blks;
        }
        function md5blk_array(a) {
          var md5blks = [], i;
          for (i = 0; i < 64; i += 4) {
            md5blks[i >> 2] = a[i] + (a[i + 1] << 8) + (a[i + 2] << 16) + (a[i + 3] << 24);
          }
          return md5blks;
        }
        function md51(s) {
          var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i, length, tail, tmp, lo, hi;
          for (i = 64; i <= n; i += 64) {
            md5cycle(state, md5blk(s.substring(i - 64, i)));
          }
          s = s.substring(i - 64);
          length = s.length;
          tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= s.charCodeAt(i) << (i % 4 << 3);
          }
          tail[i >> 2] |= 128 << (i % 4 << 3);
          if (i > 55) {
            md5cycle(state, tail);
            for (i = 0; i < 16; i += 1) {
              tail[i] = 0;
            }
          }
          tmp = n * 8;
          tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
          lo = parseInt(tmp[2], 16);
          hi = parseInt(tmp[1], 16) || 0;
          tail[14] = lo;
          tail[15] = hi;
          md5cycle(state, tail);
          return state;
        }
        function md51_array(a) {
          var n = a.length, state = [1732584193, -271733879, -1732584194, 271733878], i, length, tail, tmp, lo, hi;
          for (i = 64; i <= n; i += 64) {
            md5cycle(state, md5blk_array(a.subarray(i - 64, i)));
          }
          a = i - 64 < n ? a.subarray(i - 64) : new Uint8Array(0);
          length = a.length;
          tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= a[i] << (i % 4 << 3);
          }
          tail[i >> 2] |= 128 << (i % 4 << 3);
          if (i > 55) {
            md5cycle(state, tail);
            for (i = 0; i < 16; i += 1) {
              tail[i] = 0;
            }
          }
          tmp = n * 8;
          tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
          lo = parseInt(tmp[2], 16);
          hi = parseInt(tmp[1], 16) || 0;
          tail[14] = lo;
          tail[15] = hi;
          md5cycle(state, tail);
          return state;
        }
        function rhex(n) {
          var s = "", j;
          for (j = 0; j < 4; j += 1) {
            s += hex_chr[n >> j * 8 + 4 & 15] + hex_chr[n >> j * 8 & 15];
          }
          return s;
        }
        function hex(x) {
          var i;
          for (i = 0; i < x.length; i += 1) {
            x[i] = rhex(x[i]);
          }
          return x.join("");
        }
        if (hex(md51("hello")) !== "5d41402abc4b2a76b9719d911017c592") {
          add32 = function(x, y) {
            var lsw = (x & 65535) + (y & 65535), msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return msw << 16 | lsw & 65535;
          };
        }
        if (typeof ArrayBuffer !== "undefined" && !ArrayBuffer.prototype.slice) {
          (function() {
            function clamp(val, length) {
              val = val | 0 || 0;
              if (val < 0) {
                return Math.max(val + length, 0);
              }
              return Math.min(val, length);
            }
            ArrayBuffer.prototype.slice = function(from, to) {
              var length = this.byteLength, begin = clamp(from, length), end = length, num, target, targetArray, sourceArray;
              if (to !== undefined2) {
                end = clamp(to, length);
              }
              if (begin > end) {
                return new ArrayBuffer(0);
              }
              num = end - begin;
              target = new ArrayBuffer(num);
              targetArray = new Uint8Array(target);
              sourceArray = new Uint8Array(this, begin, num);
              targetArray.set(sourceArray);
              return target;
            };
          })();
        }
        function toUtf8(str) {
          if (/[\u0080-\uFFFF]/.test(str)) {
            str = unescape(encodeURIComponent(str));
          }
          return str;
        }
        function utf8Str2ArrayBuffer(str, returnUInt8Array) {
          var length = str.length, buff = new ArrayBuffer(length), arr = new Uint8Array(buff), i;
          for (i = 0; i < length; i += 1) {
            arr[i] = str.charCodeAt(i);
          }
          return returnUInt8Array ? arr : buff;
        }
        function arrayBuffer2Utf8Str(buff) {
          return String.fromCharCode.apply(null, new Uint8Array(buff));
        }
        function concatenateArrayBuffers(first, second, returnUInt8Array) {
          var result = new Uint8Array(first.byteLength + second.byteLength);
          result.set(new Uint8Array(first));
          result.set(new Uint8Array(second), first.byteLength);
          return returnUInt8Array ? result : result.buffer;
        }
        function hexToBinaryString(hex2) {
          var bytes = [], length = hex2.length, x;
          for (x = 0; x < length - 1; x += 2) {
            bytes.push(parseInt(hex2.substr(x, 2), 16));
          }
          return String.fromCharCode.apply(String, bytes);
        }
        function SparkMD5() {
          this.reset();
        }
        SparkMD5.prototype.append = function(str) {
          this.appendBinary(toUtf8(str));
          return this;
        };
        SparkMD5.prototype.appendBinary = function(contents) {
          this._buff += contents;
          this._length += contents.length;
          var length = this._buff.length, i;
          for (i = 64; i <= length; i += 64) {
            md5cycle(this._hash, md5blk(this._buff.substring(i - 64, i)));
          }
          this._buff = this._buff.substring(i - 64);
          return this;
        };
        SparkMD5.prototype.end = function(raw) {
          var buff = this._buff, length = buff.length, i, tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ret;
          for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= buff.charCodeAt(i) << (i % 4 << 3);
          }
          this._finish(tail, length);
          ret = hex(this._hash);
          if (raw) {
            ret = hexToBinaryString(ret);
          }
          this.reset();
          return ret;
        };
        SparkMD5.prototype.reset = function() {
          this._buff = "";
          this._length = 0;
          this._hash = [1732584193, -271733879, -1732584194, 271733878];
          return this;
        };
        SparkMD5.prototype.getState = function() {
          return {
            buff: this._buff,
            length: this._length,
            hash: this._hash.slice()
          };
        };
        SparkMD5.prototype.setState = function(state) {
          this._buff = state.buff;
          this._length = state.length;
          this._hash = state.hash;
          return this;
        };
        SparkMD5.prototype.destroy = function() {
          delete this._hash;
          delete this._buff;
          delete this._length;
        };
        SparkMD5.prototype._finish = function(tail, length) {
          var i = length, tmp, lo, hi;
          tail[i >> 2] |= 128 << (i % 4 << 3);
          if (i > 55) {
            md5cycle(this._hash, tail);
            for (i = 0; i < 16; i += 1) {
              tail[i] = 0;
            }
          }
          tmp = this._length * 8;
          tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
          lo = parseInt(tmp[2], 16);
          hi = parseInt(tmp[1], 16) || 0;
          tail[14] = lo;
          tail[15] = hi;
          md5cycle(this._hash, tail);
        };
        SparkMD5.hash = function(str, raw) {
          return SparkMD5.hashBinary(toUtf8(str), raw);
        };
        SparkMD5.hashBinary = function(content, raw) {
          var hash = md51(content), ret = hex(hash);
          return raw ? hexToBinaryString(ret) : ret;
        };
        SparkMD5.ArrayBuffer = function() {
          this.reset();
        };
        SparkMD5.ArrayBuffer.prototype.append = function(arr) {
          var buff = concatenateArrayBuffers(this._buff.buffer, arr, true), length = buff.length, i;
          this._length += arr.byteLength;
          for (i = 64; i <= length; i += 64) {
            md5cycle(this._hash, md5blk_array(buff.subarray(i - 64, i)));
          }
          this._buff = i - 64 < length ? new Uint8Array(buff.buffer.slice(i - 64)) : new Uint8Array(0);
          return this;
        };
        SparkMD5.ArrayBuffer.prototype.end = function(raw) {
          var buff = this._buff, length = buff.length, tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], i, ret;
          for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= buff[i] << (i % 4 << 3);
          }
          this._finish(tail, length);
          ret = hex(this._hash);
          if (raw) {
            ret = hexToBinaryString(ret);
          }
          this.reset();
          return ret;
        };
        SparkMD5.ArrayBuffer.prototype.reset = function() {
          this._buff = new Uint8Array(0);
          this._length = 0;
          this._hash = [1732584193, -271733879, -1732584194, 271733878];
          return this;
        };
        SparkMD5.ArrayBuffer.prototype.getState = function() {
          var state = SparkMD5.prototype.getState.call(this);
          state.buff = arrayBuffer2Utf8Str(state.buff);
          return state;
        };
        SparkMD5.ArrayBuffer.prototype.setState = function(state) {
          state.buff = utf8Str2ArrayBuffer(state.buff, true);
          return SparkMD5.prototype.setState.call(this, state);
        };
        SparkMD5.ArrayBuffer.prototype.destroy = SparkMD5.prototype.destroy;
        SparkMD5.ArrayBuffer.prototype._finish = SparkMD5.prototype._finish;
        SparkMD5.ArrayBuffer.hash = function(arr, raw) {
          var hash = md51_array(new Uint8Array(arr)), ret = hex(hash);
          return raw ? hexToBinaryString(ret) : ret;
        };
        return SparkMD5;
      });
    }
  });

  // node_modules/base64-arraybuffer/dist/base64-arraybuffer.umd.js
  var require_base64_arraybuffer_umd = __commonJS({
    "node_modules/base64-arraybuffer/dist/base64-arraybuffer.umd.js"(exports, module) {
      (function(global2, factory) {
        typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self, factory(global2["base64-arraybuffer"] = {}));
      })(exports, (function(exports2) {
        "use strict";
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
        for (var i = 0; i < chars.length; i++) {
          lookup[chars.charCodeAt(i)] = i;
        }
        var encode = function(arraybuffer) {
          var bytes = new Uint8Array(arraybuffer), i2, len = bytes.length, base64 = "";
          for (i2 = 0; i2 < len; i2 += 3) {
            base64 += chars[bytes[i2] >> 2];
            base64 += chars[(bytes[i2] & 3) << 4 | bytes[i2 + 1] >> 4];
            base64 += chars[(bytes[i2 + 1] & 15) << 2 | bytes[i2 + 2] >> 6];
            base64 += chars[bytes[i2 + 2] & 63];
          }
          if (len % 3 === 2) {
            base64 = base64.substring(0, base64.length - 1) + "=";
          } else if (len % 3 === 1) {
            base64 = base64.substring(0, base64.length - 2) + "==";
          }
          return base64;
        };
        var decode = function(base64) {
          var bufferLength = base64.length * 0.75, len = base64.length, i2, p = 0, encoded1, encoded2, encoded3, encoded4;
          if (base64[base64.length - 1] === "=") {
            bufferLength--;
            if (base64[base64.length - 2] === "=") {
              bufferLength--;
            }
          }
          var arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
          for (i2 = 0; i2 < len; i2 += 4) {
            encoded1 = lookup[base64.charCodeAt(i2)];
            encoded2 = lookup[base64.charCodeAt(i2 + 1)];
            encoded3 = lookup[base64.charCodeAt(i2 + 2)];
            encoded4 = lookup[base64.charCodeAt(i2 + 3)];
            bytes[p++] = encoded1 << 2 | encoded2 >> 4;
            bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
            bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
          }
          return arraybuffer;
        };
        exports2.decode = decode;
        exports2.encode = encode;
        Object.defineProperty(exports2, "__esModule", { value: true });
      }));
    }
  });

  // node_modules/@openim/protocol/lib/index.js
  var require_lib = __commonJS({
    "node_modules/@openim/protocol/lib/index.js"(exports) {
      var e;
      var n;
      var i;
      var t;
      e = "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : void 0, n = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.decode = function(e3) {
          if (!ArrayBuffer.isView(e3)) {
            var n2 = Object.prototype.toString.call(e3);
            if ("[object ArrayBuffer]" !== n2 && "[object SharedArrayBuffer]" !== n2 && "[object Object]" !== n2) throw new TypeError("Failed to execute 'decode' on 'TextDecoder': The provided value is not of type '(ArrayBuffer or ArrayBufferView)'");
            e3 = new Uint8Array(e3);
          }
          for (var i2 = e3, t2 = [], o2 = 0, r2 = i2.length; o2 < r2; ) {
            var s2 = i2[o2], u2 = void 0;
            if (128 & s2) {
              if (192 == (224 & s2)) u2 = (31 & s2) << 6 | 63 & i2[o2 + 1], o2 += 2;
              else if (224 == (240 & s2)) u2 = (15 & s2) << 12 | (63 & i2[o2 + 1]) << 6 | 63 & i2[o2 + 2], o2 += 3;
              else {
                if (240 != (248 & s2)) {
                  t2.push(65533), o2++;
                  continue;
                }
                u2 = (7 & s2) << 18 | (63 & i2[o2 + 1]) << 12 | (63 & i2[o2 + 2]) << 6 | 63 & i2[o2 + 3], o2 += 4;
              }
              if (u2 > 65535) {
                var a2 = u2 - 65536;
                t2.push(55296 + (a2 >> 10)), t2.push(56320 + (1023 & a2));
              } else t2.push(u2);
            } else t2.push(s2), o2++;
          }
          return String.fromCharCode.apply(String, t2);
        }, e2;
      })(), i = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.encode = function(e3) {
          for (var n2 = [], i2 = 0; i2 < e3.length; i2++) {
            var t2 = e3.charCodeAt(i2);
            if (t2 >= 55296 && t2 <= 56319 && i2 + 1 < e3.length) {
              var o2 = e3.charCodeAt(i2 + 1);
              o2 >= 56320 && o2 <= 57343 && (t2 = o2 - 56320 + (t2 - 55296 << 10) + 65536, i2++);
            }
            t2 <= 127 ? n2.push(t2) : t2 <= 2047 ? (n2.push(192 | t2 >> 6), n2.push(128 | 63 & t2)) : t2 <= 65535 ? (n2.push(224 | t2 >> 12), n2.push(128 | t2 >> 6 & 63), n2.push(128 | 63 & t2)) : (n2.push(240 | t2 >> 18), n2.push(128 | t2 >> 12 & 63), n2.push(128 | t2 >> 6 & 63), n2.push(128 | 63 & t2));
          }
          return new Uint8Array(n2);
        }, e2;
      })(), e.TextDecoder || (e.TextDecoder = n, e.TextEncoder = i), (function(e2) {
        e2[e2.PullOrderAsc = 0] = "PullOrderAsc", e2[e2.PullOrderDesc = 1] = "PullOrderDesc", e2[e2.UNRECOGNIZED = -1] = "UNRECOGNIZED";
      })(t || (t = {}));
      var o = { __proto__: null, protobufPackage: "openim.sdkws", get PullOrder() {
        return t;
      } };
      function r(e2, n2) {
        (null == n2 || n2 > e2.length) && (n2 = e2.length);
        for (var i2 = 0, t2 = Array(n2); i2 < n2; i2++) t2[i2] = e2[i2];
        return t2;
      }
      function s(e2, n2) {
        var i2 = "undefined" != typeof Symbol && e2[Symbol.iterator] || e2["@@iterator"];
        if (i2) return (i2 = i2.call(e2)).next.bind(i2);
        if (Array.isArray(e2) || (i2 = (function(e3, n3) {
          if (e3) {
            if ("string" == typeof e3) return r(e3, n3);
            var i3 = {}.toString.call(e3).slice(8, -1);
            return "Object" === i3 && e3.constructor && (i3 = e3.constructor.name), "Map" === i3 || "Set" === i3 ? Array.from(e3) : "Arguments" === i3 || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i3) ? r(e3, n3) : void 0;
          }
        })(e2)) || n2 && e2 && "number" == typeof e2.length) {
          i2 && (e2 = i2);
          var t2 = 0;
          return function() {
            return t2 >= e2.length ? { done: true } : { done: false, value: e2[t2++] };
          };
        }
        throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function u() {
        for (var e2 = 0, n2 = 0, i2 = 0; i2 < 28; i2 += 7) {
          var t2 = this.buf[this.pos++];
          if (e2 |= (127 & t2) << i2, !(128 & t2)) return this.assertBounds(), [e2, n2];
        }
        var o2 = this.buf[this.pos++];
        if (e2 |= (15 & o2) << 28, n2 = (112 & o2) >> 4, !(128 & o2)) return this.assertBounds(), [e2, n2];
        for (var r2 = 3; r2 <= 31; r2 += 7) {
          var s2 = this.buf[this.pos++];
          if (n2 |= (127 & s2) << r2, !(128 & s2)) return this.assertBounds(), [e2, n2];
        }
        throw new Error("invalid varint");
      }
      function a(e2, n2, i2) {
        for (var t2 = 0; t2 < 28; t2 += 7) {
          var o2 = e2 >>> t2, r2 = !(o2 >>> 7 == 0 && 0 == n2);
          if (i2.push(255 & (r2 ? 128 | o2 : o2)), !r2) return;
        }
        var s2 = e2 >>> 28 & 15 | (7 & n2) << 4, u2 = !!(n2 >> 3);
        if (i2.push(255 & (u2 ? 128 | s2 : s2)), u2) {
          for (var a2 = 3; a2 < 31; a2 += 7) {
            var c2 = n2 >>> a2, f2 = !(c2 >>> 7 == 0);
            if (i2.push(255 & (f2 ? 128 | c2 : c2)), !f2) return;
          }
          i2.push(n2 >>> 31 & 1);
        }
      }
      var c = 4294967296;
      function f(e2) {
        var n2 = "-" === e2[0];
        n2 && (e2 = e2.slice(1));
        var i2 = 1e6, t2 = 0, o2 = 0;
        function r2(n3, r3) {
          var s2 = Number(e2.slice(n3, r3));
          o2 *= i2, (t2 = t2 * i2 + s2) >= c && (o2 += t2 / c | 0, t2 %= c);
        }
        return r2(-24, -18), r2(-18, -12), r2(-12, -6), r2(-6), n2 ? p(t2, o2) : v(t2, o2);
      }
      function d(e2, n2) {
        var i2 = (function(e3, n3) {
          return { lo: e3 >>> 0, hi: n3 >>> 0 };
        })(e2, n2);
        if (e2 = i2.lo, (n2 = i2.hi) <= 2097151) return String(c * n2 + e2);
        var t2 = 16777215 & (e2 >>> 24 | n2 << 8), o2 = n2 >> 16 & 65535, r2 = (16777215 & e2) + 6777216 * t2 + 6710656 * o2, s2 = t2 + 8147497 * o2, u2 = 2 * o2, a2 = 1e7;
        return r2 >= a2 && (s2 += Math.floor(r2 / a2), r2 %= a2), s2 >= a2 && (u2 += Math.floor(s2 / a2), s2 %= a2), u2.toString() + k(s2) + k(r2);
      }
      function v(e2, n2) {
        return { lo: 0 | e2, hi: 0 | n2 };
      }
      function p(e2, n2) {
        return n2 = ~n2, e2 ? e2 = 1 + ~e2 : n2 += 1, v(e2, n2);
      }
      var k = function(e2) {
        var n2 = String(e2);
        return "0000000".slice(n2.length) + n2;
      };
      function g(e2, n2) {
        if (e2 >= 0) {
          for (; e2 > 127; ) n2.push(127 & e2 | 128), e2 >>>= 7;
          n2.push(e2);
        } else {
          for (var i2 = 0; i2 < 9; i2++) n2.push(127 & e2 | 128), e2 >>= 7;
          n2.push(1);
        }
      }
      function l() {
        var e2 = this.buf[this.pos++], n2 = 127 & e2;
        if (!(128 & e2)) return this.assertBounds(), n2;
        if (n2 |= (127 & (e2 = this.buf[this.pos++])) << 7, !(128 & e2)) return this.assertBounds(), n2;
        if (n2 |= (127 & (e2 = this.buf[this.pos++])) << 14, !(128 & e2)) return this.assertBounds(), n2;
        if (n2 |= (127 & (e2 = this.buf[this.pos++])) << 21, !(128 & e2)) return this.assertBounds(), n2;
        n2 |= (15 & (e2 = this.buf[this.pos++])) << 28;
        for (var i2 = 5; 128 & e2 && i2 < 10; i2++) e2 = this.buf[this.pos++];
        if (128 & e2) throw new Error("invalid varint");
        return this.assertBounds(), n2 >>> 0;
      }
      var b = /* @__PURE__ */ h();
      function h() {
        var e2 = new DataView(new ArrayBuffer(8));
        if ("function" == typeof BigInt && "function" == typeof e2.getBigInt64 && "function" == typeof e2.getBigUint64 && "function" == typeof e2.setBigInt64 && "function" == typeof e2.setBigUint64 && ("object" != typeof process || "object" != typeof process.env || "1" !== process.env.BUF_BIGINT_DISABLE)) {
          var n2 = BigInt("-9223372036854775808"), i2 = BigInt("9223372036854775807"), t2 = BigInt("0"), o2 = BigInt("18446744073709551615");
          return { zero: BigInt(0), supported: true, parse: function(e3) {
            var t3 = "bigint" == typeof e3 ? e3 : BigInt(e3);
            if (t3 > i2 || t3 < n2) throw new Error("invalid int64: " + e3);
            return t3;
          }, uParse: function(e3) {
            var n3 = "bigint" == typeof e3 ? e3 : BigInt(e3);
            if (n3 > o2 || n3 < t2) throw new Error("invalid uint64: " + e3);
            return n3;
          }, enc: function(n3) {
            return e2.setBigInt64(0, this.parse(n3), true), { lo: e2.getInt32(0, true), hi: e2.getInt32(4, true) };
          }, uEnc: function(n3) {
            return e2.setBigInt64(0, this.uParse(n3), true), { lo: e2.getInt32(0, true), hi: e2.getInt32(4, true) };
          }, dec: function(n3, i3) {
            return e2.setInt32(0, n3, true), e2.setInt32(4, i3, true), e2.getBigInt64(0, true);
          }, uDec: function(n3, i3) {
            return e2.setInt32(0, n3, true), e2.setInt32(4, i3, true), e2.getBigUint64(0, true);
          } };
        }
        return { zero: "0", supported: false, parse: function(e3) {
          return "string" != typeof e3 && (e3 = e3.toString()), I(e3), e3;
        }, uParse: function(e3) {
          return "string" != typeof e3 && (e3 = e3.toString()), D(e3), e3;
        }, enc: function(e3) {
          return "string" != typeof e3 && (e3 = e3.toString()), I(e3), f(e3);
        }, uEnc: function(e3) {
          return "string" != typeof e3 && (e3 = e3.toString()), D(e3), f(e3);
        }, dec: function(e3, n3) {
          return (function(e4, n4) {
            var i3 = v(e4, n4), t3 = 2147483648 & i3.hi;
            t3 && (i3 = p(i3.lo, i3.hi));
            var o3 = d(i3.lo, i3.hi);
            return t3 ? "-" + o3 : o3;
          })(e3, n3);
        }, uDec: function(e3, n3) {
          return d(e3, n3);
        } };
      }
      function I(e2) {
        if (!/^-?[0-9]+$/.test(e2)) throw new Error("invalid int64: " + e2);
      }
      function D(e2) {
        if (!/^[0-9]+$/.test(e2)) throw new Error("invalid uint64: " + e2);
      }
      var w;
      var m = /* @__PURE__ */ Symbol.for("@bufbuild/protobuf/text-encoding");
      function y() {
        if (null == globalThis[m]) {
          var e2 = new globalThis.TextEncoder(), n2 = new globalThis.TextDecoder();
          globalThis[m] = { encodeUtf8: function(n3) {
            return e2.encode(n3);
          }, decodeUtf8: function(e3) {
            return n2.decode(e3);
          }, checkUtf8: function(e3) {
            try {
              return encodeURIComponent(e3), true;
            } catch (e4) {
              return false;
            }
          } };
        }
        return globalThis[m];
      }
      !(function(e2) {
        e2[e2.Varint = 0] = "Varint", e2[e2.Bit64 = 1] = "Bit64", e2[e2.LengthDelimited = 2] = "LengthDelimited", e2[e2.StartGroup = 3] = "StartGroup", e2[e2.EndGroup = 4] = "EndGroup", e2[e2.Bit32 = 5] = "Bit32";
      })(w || (w = {}));
      var U = /* @__PURE__ */ (function() {
        function e2(e3) {
          void 0 === e3 && (e3 = y().encodeUtf8), this.encodeUtf8 = void 0, this.chunks = void 0, this.buf = void 0, this.stack = [], this.encodeUtf8 = e3, this.chunks = [], this.buf = [];
        }
        var n2 = e2.prototype;
        return n2.finish = function() {
          this.buf.length && (this.chunks.push(new Uint8Array(this.buf)), this.buf = []);
          for (var e3 = 0, n3 = 0; n3 < this.chunks.length; n3++) e3 += this.chunks[n3].length;
          for (var i2 = new Uint8Array(e3), t2 = 0, o2 = 0; o2 < this.chunks.length; o2++) i2.set(this.chunks[o2], t2), t2 += this.chunks[o2].length;
          return this.chunks = [], i2;
        }, n2.fork = function() {
          return this.stack.push({ chunks: this.chunks, buf: this.buf }), this.chunks = [], this.buf = [], this;
        }, n2.join = function() {
          var e3 = this.finish(), n3 = this.stack.pop();
          if (!n3) throw new Error("invalid state, fork stack empty");
          return this.chunks = n3.chunks, this.buf = n3.buf, this.uint32(e3.byteLength), this.raw(e3);
        }, n2.tag = function(e3, n3) {
          return this.uint32((e3 << 3 | n3) >>> 0);
        }, n2.raw = function(e3) {
          return this.buf.length && (this.chunks.push(new Uint8Array(this.buf)), this.buf = []), this.chunks.push(e3), this;
        }, n2.uint32 = function(e3) {
          for (T(e3); e3 > 127; ) this.buf.push(127 & e3 | 128), e3 >>>= 7;
          return this.buf.push(e3), this;
        }, n2.int32 = function(e3) {
          return R(e3), g(e3, this.buf), this;
        }, n2.bool = function(e3) {
          return this.buf.push(e3 ? 1 : 0), this;
        }, n2.bytes = function(e3) {
          return this.uint32(e3.byteLength), this.raw(e3);
        }, n2.string = function(e3) {
          var n3 = this.encodeUtf8(e3);
          return this.uint32(n3.byteLength), this.raw(n3);
        }, n2.float = function(e3) {
          !(function(e4) {
            if ("string" == typeof e4) {
              var n4 = e4;
              if (e4 = Number(e4), isNaN(e4) && "NaN" !== n4) throw new Error("invalid float32: " + n4);
            } else if ("number" != typeof e4) throw new Error("invalid float32: " + typeof e4);
            if (Number.isFinite(e4) && (e4 > 34028234663852886e22 || e4 < -34028234663852886e22)) throw new Error("invalid float32: " + e4);
          })(e3);
          var n3 = new Uint8Array(4);
          return new DataView(n3.buffer).setFloat32(0, e3, true), this.raw(n3);
        }, n2.double = function(e3) {
          var n3 = new Uint8Array(8);
          return new DataView(n3.buffer).setFloat64(0, e3, true), this.raw(n3);
        }, n2.fixed32 = function(e3) {
          T(e3);
          var n3 = new Uint8Array(4);
          return new DataView(n3.buffer).setUint32(0, e3, true), this.raw(n3);
        }, n2.sfixed32 = function(e3) {
          R(e3);
          var n3 = new Uint8Array(4);
          return new DataView(n3.buffer).setInt32(0, e3, true), this.raw(n3);
        }, n2.sint32 = function(e3) {
          return R(e3), g(e3 = (e3 << 1 ^ e3 >> 31) >>> 0, this.buf), this;
        }, n2.sfixed64 = function(e3) {
          var n3 = new Uint8Array(8), i2 = new DataView(n3.buffer), t2 = b.enc(e3);
          return i2.setInt32(0, t2.lo, true), i2.setInt32(4, t2.hi, true), this.raw(n3);
        }, n2.fixed64 = function(e3) {
          var n3 = new Uint8Array(8), i2 = new DataView(n3.buffer), t2 = b.uEnc(e3);
          return i2.setInt32(0, t2.lo, true), i2.setInt32(4, t2.hi, true), this.raw(n3);
        }, n2.int64 = function(e3) {
          var n3 = b.enc(e3);
          return a(n3.lo, n3.hi, this.buf), this;
        }, n2.sint64 = function(e3) {
          var n3 = b.enc(e3), i2 = n3.hi >> 31;
          return a(n3.lo << 1 ^ i2, (n3.hi << 1 | n3.lo >>> 31) ^ i2, this.buf), this;
        }, n2.uint64 = function(e3) {
          var n3 = b.uEnc(e3);
          return a(n3.lo, n3.hi, this.buf), this;
        }, e2;
      })();
      var S = /* @__PURE__ */ (function() {
        function e2(e3, n3) {
          void 0 === n3 && (n3 = y().decodeUtf8), this.decodeUtf8 = void 0, this.pos = void 0, this.len = void 0, this.buf = void 0, this.view = void 0, this.varint64 = u, this.uint32 = l, this.decodeUtf8 = n3, this.buf = e3, this.len = e3.length, this.pos = 0, this.view = new DataView(e3.buffer, e3.byteOffset, e3.byteLength);
        }
        var n2 = e2.prototype;
        return n2.tag = function() {
          var e3 = this.uint32(), n3 = e3 >>> 3, i2 = 7 & e3;
          if (n3 <= 0 || i2 < 0 || i2 > 5) throw new Error("illegal tag: field no " + n3 + " wire type " + i2);
          return [n3, i2];
        }, n2.skip = function(e3, n3) {
          var i2 = this.pos;
          switch (e3) {
            case w.Varint:
              for (; 128 & this.buf[this.pos++]; ) ;
              break;
            case w.Bit64:
              this.pos += 4;
            case w.Bit32:
              this.pos += 4;
              break;
            case w.LengthDelimited:
              var t2 = this.uint32();
              this.pos += t2;
              break;
            case w.StartGroup:
              for (; ; ) {
                var o2 = this.tag(), r2 = o2[0], s2 = o2[1];
                if (s2 === w.EndGroup) {
                  if (void 0 !== n3 && r2 !== n3) throw new Error("invalid end group tag");
                  break;
                }
                this.skip(s2, r2);
              }
              break;
            default:
              throw new Error("cant skip wire type " + e3);
          }
          return this.assertBounds(), this.buf.subarray(i2, this.pos);
        }, n2.assertBounds = function() {
          if (this.pos > this.len) throw new RangeError("premature EOF");
        }, n2.int32 = function() {
          return 0 | this.uint32();
        }, n2.sint32 = function() {
          var e3 = this.uint32();
          return e3 >>> 1 ^ -(1 & e3);
        }, n2.int64 = function() {
          return b.dec.apply(b, this.varint64());
        }, n2.uint64 = function() {
          return b.uDec.apply(b, this.varint64());
        }, n2.sint64 = function() {
          var e3 = this.varint64(), n3 = e3[0], i2 = e3[1], t2 = -(1 & n3);
          return b.dec(n3 = (n3 >>> 1 | (1 & i2) << 31) ^ t2, i2 = i2 >>> 1 ^ t2);
        }, n2.bool = function() {
          var e3 = this.varint64();
          return 0 !== e3[0] || 0 !== e3[1];
        }, n2.fixed32 = function() {
          return this.view.getUint32((this.pos += 4) - 4, true);
        }, n2.sfixed32 = function() {
          return this.view.getInt32((this.pos += 4) - 4, true);
        }, n2.fixed64 = function() {
          return b.uDec(this.sfixed32(), this.sfixed32());
        }, n2.sfixed64 = function() {
          return b.dec(this.sfixed32(), this.sfixed32());
        }, n2.float = function() {
          return this.view.getFloat32((this.pos += 4) - 4, true);
        }, n2.double = function() {
          return this.view.getFloat64((this.pos += 8) - 8, true);
        }, n2.bytes = function() {
          var e3 = this.uint32(), n3 = this.pos;
          return this.pos += e3, this.assertBounds(), this.buf.subarray(n3, n3 + e3);
        }, n2.string = function() {
          return this.decodeUtf8(this.bytes());
        }, e2;
      })();
      function R(e2) {
        if ("string" == typeof e2) e2 = Number(e2);
        else if ("number" != typeof e2) throw new Error("invalid int32: " + typeof e2);
        if (!Number.isInteger(e2) || e2 > 2147483647 || e2 < -2147483648) throw new Error("invalid int32: " + e2);
      }
      function T(e2) {
        if ("string" == typeof e2) e2 = Number(e2);
        else if ("number" != typeof e2) throw new Error("invalid uint32: " + typeof e2);
        if (!Number.isInteger(e2) || e2 > 4294967295 || e2 < 0) throw new Error("invalid uint32: " + e2);
      }
      function M(e2) {
        var n2 = globalThis.Number(e2.toString());
        if (n2 > globalThis.Number.MAX_SAFE_INTEGER) throw new globalThis.Error("Value is larger than Number.MAX_SAFE_INTEGER");
        if (n2 < globalThis.Number.MIN_SAFE_INTEGER) throw new globalThis.Error("Value is smaller than Number.MIN_SAFE_INTEGER");
        return n2;
      }
      var j = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.title && n2.uint32(10).string(e2.title), "" !== e2.desc && n2.uint32(18).string(e2.desc), "" !== e2.ex && n2.uint32(26).string(e2.ex), "" !== e2.iOSPushSound && n2.uint32(34).string(e2.iOSPushSound), false !== e2.iOSBadgeCount && n2.uint32(40).bool(e2.iOSBadgeCount), "" !== e2.signalInfo && n2.uint32(50).string(e2.signalInfo), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { title: "", desc: "", ex: "", iOSPushSound: "", iOSBadgeCount: false, signalInfo: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.title = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.desc = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.iOSPushSound = i2.string();
              continue;
            case 5:
              if (40 !== r2) break;
              o2.iOSBadgeCount = i2.bool();
              continue;
            case 6:
              if (50 !== r2) break;
              o2.signalInfo = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var P = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), false !== e2.value && n2.uint32(16).bool(e2.value), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (16 !== r2) break;
              o2.value = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var x = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.sendID && n2.uint32(10).string(e2.sendID), "" !== e2.recvID && n2.uint32(18).string(e2.recvID), "" !== e2.groupID && n2.uint32(26).string(e2.groupID), "" !== e2.clientMsgID && n2.uint32(34).string(e2.clientMsgID), "" !== e2.serverMsgID && n2.uint32(42).string(e2.serverMsgID), 0 !== e2.senderPlatformID && n2.uint32(48).int32(e2.senderPlatformID), "" !== e2.senderNickname && n2.uint32(58).string(e2.senderNickname), "" !== e2.senderFaceURL && n2.uint32(66).string(e2.senderFaceURL), 0 !== e2.sessionType && n2.uint32(72).int32(e2.sessionType), 0 !== e2.msgFrom && n2.uint32(80).int32(e2.msgFrom), 0 !== e2.contentType && n2.uint32(88).int32(e2.contentType), 0 !== e2.content.length && n2.uint32(98).bytes(e2.content), 0 !== e2.seq && n2.uint32(112).int64(e2.seq), 0 !== e2.sendTime && n2.uint32(120).int64(e2.sendTime), 0 !== e2.createTime && n2.uint32(128).int64(e2.createTime), 0 !== e2.status && n2.uint32(136).int32(e2.status), false !== e2.isRead && n2.uint32(144).bool(e2.isRead), Object.entries(e2.options).forEach(function(e3) {
          P.encode({ key: e3[0], value: e3[1] }, n2.uint32(154).fork()).join();
        }), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(162).fork()).join();
        for (var i2, t2 = s(e2.atUserIDList); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(170).string(o2);
        }
        "" !== e2.attachedInfo && n2.uint32(178).string(e2.attachedInfo), "" !== e2.ex && n2.uint32(186).string(e2.ex), 0 !== e2.keyVersion && n2.uint32(320).int32(e2.keyVersion);
        for (var r2, u2 = s(e2.dstUserIDs); !(r2 = u2()).done; ) {
          var a2 = r2.value;
          n2.uint32(330).string(a2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { sendID: "", recvID: "", groupID: "", clientMsgID: "", serverMsgID: "", senderPlatformID: 0, senderNickname: "", senderFaceURL: "", sessionType: 0, msgFrom: 0, contentType: 0, content: new Uint8Array(0), seq: 0, sendTime: 0, createTime: 0, status: 0, isRead: false, options: {}, offlinePushInfo: void 0, atUserIDList: [], attachedInfo: "", ex: "", keyVersion: 0, dstUserIDs: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.sendID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.recvID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.groupID = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.clientMsgID = i2.string();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.serverMsgID = i2.string();
              continue;
            case 6:
              if (48 !== r2) break;
              o2.senderPlatformID = i2.int32();
              continue;
            case 7:
              if (58 !== r2) break;
              o2.senderNickname = i2.string();
              continue;
            case 8:
              if (66 !== r2) break;
              o2.senderFaceURL = i2.string();
              continue;
            case 9:
              if (72 !== r2) break;
              o2.sessionType = i2.int32();
              continue;
            case 10:
              if (80 !== r2) break;
              o2.msgFrom = i2.int32();
              continue;
            case 11:
              if (88 !== r2) break;
              o2.contentType = i2.int32();
              continue;
            case 12:
              if (98 !== r2) break;
              o2.content = i2.bytes();
              continue;
            case 14:
              if (112 !== r2) break;
              o2.seq = M(i2.int64());
              continue;
            case 15:
              if (120 !== r2) break;
              o2.sendTime = M(i2.int64());
              continue;
            case 16:
              if (128 !== r2) break;
              o2.createTime = M(i2.int64());
              continue;
            case 17:
              if (136 !== r2) break;
              o2.status = i2.int32();
              continue;
            case 18:
              if (144 !== r2) break;
              o2.isRead = i2.bool();
              continue;
            case 19:
              if (154 !== r2) break;
              var s2 = P.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.options[s2.key] = s2.value);
              continue;
            case 20:
              if (162 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 21:
              if (170 !== r2) break;
              o2.atUserIDList.push(i2.string());
              continue;
            case 22:
              if (178 !== r2) break;
              o2.attachedInfo = i2.string();
              continue;
            case 23:
              if (186 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 40:
              if (320 !== r2) break;
              o2.keyVersion = i2.int32();
              continue;
            case 41:
              if (330 !== r2) break;
              o2.dstUserIDs.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var q = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.conversationID && n2.uint32(10).string(e2.conversationID), 0 !== e2.begin && n2.uint32(16).int64(e2.begin), 0 !== e2.end && n2.uint32(24).int64(e2.end), 0 !== e2.num && n2.uint32(32).int64(e2.num), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { conversationID: "", begin: 0, end: 0, num: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.conversationID = i2.string();
              continue;
            case 2:
              if (16 !== r2) break;
              o2.begin = M(i2.int64());
              continue;
            case 3:
              if (24 !== r2) break;
              o2.end = M(i2.int64());
              continue;
            case 4:
              if (32 !== r2) break;
              o2.num = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var E = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID);
        for (var i2, t2 = s(e2.seqRanges); !(i2 = t2()).done; ) q.encode(i2.value, n2.uint32(18).fork()).join();
        return 0 !== e2.order && n2.uint32(24).int32(e2.order), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", seqRanges: [], order: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.seqRanges.push(q.decode(i2, i2.uint32()));
              continue;
            case 3:
              if (24 !== r2) break;
              o2.order = i2.int32();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var L = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), 0 !== e2.value && n2.uint32(16).int64(e2.value), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (16 !== r2) break;
              o2.value = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var _ = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), 0 !== e2.value && n2.uint32(16).int64(e2.value), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (16 !== r2) break;
              o2.value = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var B = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), Object.entries(e2.maxSeqs).forEach(function(e3) {
          L.encode({ key: e3[0], value: e3[1] }, n2.uint32(10).fork()).join();
        }), Object.entries(e2.minSeqs).forEach(function(e3) {
          _.encode({ key: e3[0], value: e3[1] }, n2.uint32(18).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { maxSeqs: {}, minSeqs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              var s2 = L.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.maxSeqs[s2.key] = s2.value);
              continue;
            case 2:
              if (18 !== r2) break;
              var u2 = _.decode(i2, i2.uint32());
              void 0 !== u2.value && (o2.minSeqs[u2.key] = u2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var A = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), Object.entries(e2.msgs).forEach(function(e3) {
          O.encode({ key: e3[0], value: e3[1] }, n2.uint32(10).fork()).join();
        }), Object.entries(e2.notificationMsgs).forEach(function(e3) {
          C.encode({ key: e3[0], value: e3[1] }, n2.uint32(18).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { msgs: {}, notificationMsgs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              var s2 = O.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.msgs[s2.key] = s2.value);
              continue;
            case 2:
              if (18 !== r2) break;
              var u2 = C.decode(i2, i2.uint32());
              void 0 !== u2.value && (o2.notificationMsgs[u2.key] = u2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var O = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var C = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var G = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U());
        for (var i2, t2 = s(e2.Msgs); !(i2 = t2()).done; ) x.encode(i2.value, n2.uint32(10).fork()).join();
        return false !== e2.isEnd && n2.uint32(16).bool(e2.isEnd), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { Msgs: [], isEnd: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.Msgs.push(x.decode(i2, i2.uint32()));
              continue;
            case 2:
              if (16 !== r2) break;
              o2.isEnd = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var N = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), Object.entries(e2.msgs).forEach(function(e3) {
          F.encode({ key: e3[0], value: e3[1] }, n2.uint32(10).fork()).join();
        }), Object.entries(e2.notificationMsgs).forEach(function(e3) {
          V.encode({ key: e3[0], value: e3[1] }, n2.uint32(18).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { msgs: {}, notificationMsgs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              var s2 = F.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.msgs[s2.key] = s2.value);
              continue;
            case 2:
              if (18 !== r2) break;
              var u2 = V.decode(i2, i2.uint32());
              void 0 !== u2.value && (o2.notificationMsgs[u2.key] = u2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var F = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var V = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var H = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID), n2.uint32(18).fork();
        for (var i2, t2 = s(e2.onlinePlatformIDs); !(i2 = t2()).done; ) n2.int32(i2.value);
        return n2.join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", onlinePlatformIDs: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (16 === r2) {
                o2.onlinePlatformIDs.push(i2.int32());
                continue;
              }
              if (18 === r2) {
                for (var s2 = i2.uint32() + i2.pos; i2.pos < s2; ) o2.onlinePlatformIDs.push(i2.int32());
                continue;
              }
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var $ = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U());
        for (var i2, t2 = s(e2.subscribers); !(i2 = t2()).done; ) H.encode(i2.value, n2.uint32(10).fork()).join();
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { subscribers: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.subscribers.push(H.decode(i2, i2.uint32()));
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var z = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.ownerUserID && n2.uint32(10).string(e2.ownerUserID), "" !== e2.conversationID && n2.uint32(18).string(e2.conversationID), 0 !== e2.recvMsgOpt && n2.uint32(24).int32(e2.recvMsgOpt), 0 !== e2.conversationType && n2.uint32(32).int32(e2.conversationType), "" !== e2.userID && n2.uint32(42).string(e2.userID), "" !== e2.groupID && n2.uint32(50).string(e2.groupID), false !== e2.isPinned && n2.uint32(56).bool(e2.isPinned), "" !== e2.attachedInfo && n2.uint32(66).string(e2.attachedInfo), false !== e2.isPrivateChat && n2.uint32(72).bool(e2.isPrivateChat), 0 !== e2.groupAtType && n2.uint32(80).int32(e2.groupAtType), "" !== e2.ex && n2.uint32(90).string(e2.ex), 0 !== e2.burnDuration && n2.uint32(96).int32(e2.burnDuration), 0 !== e2.minSeq && n2.uint32(104).int64(e2.minSeq), 0 !== e2.maxSeq && n2.uint32(112).int64(e2.maxSeq), 0 !== e2.msgDestructTime && n2.uint32(120).int64(e2.msgDestructTime), 0 !== e2.latestMsgDestructTime && n2.uint32(128).int64(e2.latestMsgDestructTime), false !== e2.isMsgDestruct && n2.uint32(136).bool(e2.isMsgDestruct), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { ownerUserID: "", conversationID: "", recvMsgOpt: 0, conversationType: 0, userID: "", groupID: "", isPinned: false, attachedInfo: "", isPrivateChat: false, groupAtType: 0, ex: "", burnDuration: 0, minSeq: 0, maxSeq: 0, msgDestructTime: 0, latestMsgDestructTime: 0, isMsgDestruct: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.ownerUserID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversationID = i2.string();
              continue;
            case 3:
              if (24 !== r2) break;
              o2.recvMsgOpt = i2.int32();
              continue;
            case 4:
              if (32 !== r2) break;
              o2.conversationType = i2.int32();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 6:
              if (50 !== r2) break;
              o2.groupID = i2.string();
              continue;
            case 7:
              if (56 !== r2) break;
              o2.isPinned = i2.bool();
              continue;
            case 8:
              if (66 !== r2) break;
              o2.attachedInfo = i2.string();
              continue;
            case 9:
              if (72 !== r2) break;
              o2.isPrivateChat = i2.bool();
              continue;
            case 10:
              if (80 !== r2) break;
              o2.groupAtType = i2.int32();
              continue;
            case 11:
              if (90 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 12:
              if (96 !== r2) break;
              o2.burnDuration = i2.int32();
              continue;
            case 13:
              if (104 !== r2) break;
              o2.minSeq = M(i2.int64());
              continue;
            case 14:
              if (112 !== r2) break;
              o2.maxSeq = M(i2.int64());
              continue;
            case 15:
              if (120 !== r2) break;
              o2.msgDestructTime = M(i2.int64());
              continue;
            case 16:
              if (128 !== r2) break;
              o2.latestMsgDestructTime = M(i2.int64());
              continue;
            case 17:
              if (136 !== r2) break;
              o2.isMsgDestruct = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var W = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID), "" !== e2.nickname && n2.uint32(18).string(e2.nickname), "" !== e2.faceURL && n2.uint32(26).string(e2.faceURL), "" !== e2.ex && n2.uint32(34).string(e2.ex), 0 !== e2.createTime && n2.uint32(40).int64(e2.createTime), 0 !== e2.appMangerLevel && n2.uint32(48).int32(e2.appMangerLevel), 0 !== e2.globalRecvMsgOpt && n2.uint32(56).int32(e2.globalRecvMsgOpt), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", nickname: "", faceURL: "", ex: "", createTime: 0, appMangerLevel: 0, globalRecvMsgOpt: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.nickname = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.faceURL = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 5:
              if (40 !== r2) break;
              o2.createTime = M(i2.int64());
              continue;
            case 6:
              if (48 !== r2) break;
              o2.appMangerLevel = i2.int32();
              continue;
            case 7:
              if (56 !== r2) break;
              o2.globalRecvMsgOpt = i2.int32();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var X = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.ownerUserID && n2.uint32(10).string(e2.ownerUserID), "" !== e2.friendUserID && n2.uint32(18).string(e2.friendUserID), "" !== e2.remark && n2.uint32(26).string(e2.remark), 0 !== e2.createTime && n2.uint32(32).int64(e2.createTime), 0 !== e2.addSource && n2.uint32(40).int32(e2.addSource), "" !== e2.operatorUserID && n2.uint32(50).string(e2.operatorUserID), "" !== e2.ex && n2.uint32(58).string(e2.ex), false !== e2.isPinned && n2.uint32(64).bool(e2.isPinned), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { ownerUserID: "", friendUserID: "", remark: "", createTime: 0, addSource: 0, operatorUserID: "", ex: "", isPinned: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.ownerUserID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.friendUserID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.remark = i2.string();
              continue;
            case 4:
              if (32 !== r2) break;
              o2.createTime = M(i2.int64());
              continue;
            case 5:
              if (40 !== r2) break;
              o2.addSource = i2.int32();
              continue;
            case 6:
              if (50 !== r2) break;
              o2.operatorUserID = i2.string();
              continue;
            case 7:
              if (58 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 8:
              if (64 !== r2) break;
              o2.isPinned = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Z = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.groupID && n2.uint32(10).string(e2.groupID), "" !== e2.groupName && n2.uint32(18).string(e2.groupName), "" !== e2.notification && n2.uint32(26).string(e2.notification), "" !== e2.introduction && n2.uint32(34).string(e2.introduction), "" !== e2.faceURL && n2.uint32(42).string(e2.faceURL), "" !== e2.ownerUserID && n2.uint32(50).string(e2.ownerUserID), 0 !== e2.createTime && n2.uint32(56).int64(e2.createTime), 0 !== e2.memberCount && n2.uint32(64).uint32(e2.memberCount), "" !== e2.ex && n2.uint32(74).string(e2.ex), 0 !== e2.status && n2.uint32(80).int32(e2.status), "" !== e2.creatorUserID && n2.uint32(90).string(e2.creatorUserID), 0 !== e2.groupType && n2.uint32(96).int32(e2.groupType), 0 !== e2.needVerification && n2.uint32(104).int32(e2.needVerification), 0 !== e2.lookMemberInfo && n2.uint32(112).int32(e2.lookMemberInfo), 0 !== e2.applyMemberFriend && n2.uint32(120).int32(e2.applyMemberFriend), 0 !== e2.notificationUpdateTime && n2.uint32(128).int64(e2.notificationUpdateTime), "" !== e2.notificationUserID && n2.uint32(138).string(e2.notificationUserID), false !== e2.displayIsRead && n2.uint32(144).bool(e2.displayIsRead), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { groupID: "", groupName: "", notification: "", introduction: "", faceURL: "", ownerUserID: "", createTime: 0, memberCount: 0, ex: "", status: 0, creatorUserID: "", groupType: 0, needVerification: 0, lookMemberInfo: 0, applyMemberFriend: 0, notificationUpdateTime: 0, notificationUserID: "", displayIsRead: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.groupID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.groupName = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.notification = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.introduction = i2.string();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.faceURL = i2.string();
              continue;
            case 6:
              if (50 !== r2) break;
              o2.ownerUserID = i2.string();
              continue;
            case 7:
              if (56 !== r2) break;
              o2.createTime = M(i2.int64());
              continue;
            case 8:
              if (64 !== r2) break;
              o2.memberCount = i2.uint32();
              continue;
            case 9:
              if (74 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 10:
              if (80 !== r2) break;
              o2.status = i2.int32();
              continue;
            case 11:
              if (90 !== r2) break;
              o2.creatorUserID = i2.string();
              continue;
            case 12:
              if (96 !== r2) break;
              o2.groupType = i2.int32();
              continue;
            case 13:
              if (104 !== r2) break;
              o2.needVerification = i2.int32();
              continue;
            case 14:
              if (112 !== r2) break;
              o2.lookMemberInfo = i2.int32();
              continue;
            case 15:
              if (120 !== r2) break;
              o2.applyMemberFriend = i2.int32();
              continue;
            case 16:
              if (128 !== r2) break;
              o2.notificationUpdateTime = M(i2.int64());
              continue;
            case 17:
              if (138 !== r2) break;
              o2.notificationUserID = i2.string();
              continue;
            case 18:
              if (144 !== r2) break;
              o2.displayIsRead = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var J = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.conversation && z.encode(e2.conversation, n2.uint32(10).fork()).join(), void 0 !== e2.lastMsg && x.encode(e2.lastMsg, n2.uint32(18).fork()).join(), void 0 !== e2.user && W.encode(e2.user, n2.uint32(26).fork()).join(), void 0 !== e2.friend && X.encode(e2.friend, n2.uint32(34).fork()).join(), void 0 !== e2.group && Z.encode(e2.group, n2.uint32(42).fork()).join(), 0 !== e2.maxSeq && n2.uint32(48).int64(e2.maxSeq), 0 !== e2.readSeq && n2.uint32(56).int64(e2.readSeq), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { conversation: void 0, lastMsg: void 0, user: void 0, friend: void 0, group: void 0, maxSeq: 0, readSeq: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.conversation = z.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.lastMsg = x.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.user = W.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.friend = X.decode(i2, i2.uint32());
              continue;
            case 5:
              if (42 !== r2) break;
              o2.group = Z.decode(i2, i2.uint32());
              continue;
            case 6:
              if (48 !== r2) break;
              o2.maxSeq = M(i2.int64());
              continue;
            case 7:
              if (56 !== r2) break;
              o2.readSeq = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var K = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), 0 !== e2.unreadCount && n2.uint32(8).int64(e2.unreadCount);
        for (var i2, t2 = s(e2.conversations); !(i2 = t2()).done; ) J.encode(i2.value, n2.uint32(18).fork()).join();
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { unreadCount: 0, conversations: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (8 !== r2) break;
              o2.unreadCount = M(i2.int64());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversations.push(J.decode(i2, i2.uint32()));
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Q = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), 0 !== e2.unreadCount && n2.uint32(8).int64(e2.unreadCount);
        for (var i2, t2 = s(e2.conversations); !(i2 = t2()).done; ) J.encode(i2.value, n2.uint32(18).fork()).join();
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { unreadCount: 0, conversations: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (8 !== r2) break;
              o2.unreadCount = M(i2.int64());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversations.push(J.decode(i2, i2.uint32()));
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Y = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.conversationID && n2.uint32(18).string(e2.conversationID), n2.uint32(26).fork();
        for (var i2, t2 = s(e2.seqs); !(i2 = t2()).done; ) n2.int64(i2.value);
        return n2.join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { conversationID: "", seqs: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 2:
              if (18 !== r2) break;
              o2.conversationID = i2.string();
              continue;
            case 3:
              if (24 === r2) {
                o2.seqs.push(M(i2.int64()));
                continue;
              }
              if (26 === r2) {
                for (var s2 = i2.uint32() + i2.pos; i2.pos < s2; ) o2.seqs.push(M(i2.int64()));
                continue;
              }
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ee = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID);
        for (var i2, t2 = s(e2.conversations); !(i2 = t2()).done; ) Y.encode(i2.value, n2.uint32(18).fork()).join();
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", conversations: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversations.push(Y.decode(i2, i2.uint32()));
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ne = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), Object.entries(e2.msgs).forEach(function(e3) {
          ie.encode({ key: e3[0], value: e3[1] }, n2.uint32(10).fork()).join();
        }), Object.entries(e2.notificationMsgs).forEach(function(e3) {
          te.encode({ key: e3[0], value: e3[1] }, n2.uint32(18).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { msgs: {}, notificationMsgs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              var s2 = ie.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.msgs[s2.key] = s2.value);
              continue;
            case 2:
              if (18 !== r2) break;
              var u2 = te.decode(i2, i2.uint32());
              void 0 !== u2.value && (o2.notificationMsgs[u2.key] = u2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ie = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var te = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && G.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = G.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var oe = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), Object.entries(e2.seqs).forEach(function(e3) {
          se.encode({ key: e3[0], value: e3[1] }, n2.uint32(10).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { seqs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              var s2 = se.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.seqs[s2.key] = s2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var re = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), 0 !== e2.maxSeq && n2.uint32(8).int64(e2.maxSeq), 0 !== e2.hasReadSeq && n2.uint32(16).int64(e2.hasReadSeq), 0 !== e2.maxSeqTime && n2.uint32(24).int64(e2.maxSeqTime), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { maxSeq: 0, hasReadSeq: 0, maxSeqTime: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (8 !== r2) break;
              o2.maxSeq = M(i2.int64());
              continue;
            case 2:
              if (16 !== r2) break;
              o2.hasReadSeq = M(i2.int64());
              continue;
            case 3:
              if (24 !== r2) break;
              o2.maxSeqTime = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var se = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), void 0 !== e2.value && re.encode(e2.value, n2.uint32(18).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = re.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ue = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID), "" !== e2.conversationID && n2.uint32(18).string(e2.conversationID), Object.entries(e2.clientMsgs).forEach(function(e3) {
          ae.encode({ key: e3[0], value: e3[1] }, n2.uint32(26).fork()).join();
        }), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", conversationID: "", clientMsgs: {} }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversationID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              var s2 = ae.decode(i2, i2.uint32());
              void 0 !== s2.value && (o2.clientMsgs[s2.key] = s2.value);
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ae = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.key && n2.uint32(10).string(e2.key), "" !== e2.value && n2.uint32(18).string(e2.value), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { key: "", value: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.key = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.value = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ce = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.token && n2.uint32(10).string(e2.token), "" !== e2.roomID && n2.uint32(18).string(e2.roomID), "" !== e2.liveURL && n2.uint32(26).string(e2.liveURL);
        for (var i2, t2 = s(e2.busyLineUserIDList); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(34).string(o2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { token: "", roomID: "", liveURL: "", busyLineUserIDList: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.token = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.liveURL = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.busyLineUserIDList.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var fe = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invite && ce.encode(e2.invite, n2.uint32(10).fork()).join(), void 0 !== e2.inviteInGroup && de.encode(e2.inviteInGroup, n2.uint32(18).fork()).join(), void 0 !== e2.cancel && ve.encode(e2.cancel, n2.uint32(26).fork()).join(), void 0 !== e2.accept && pe.encode(e2.accept, n2.uint32(34).fork()).join(), void 0 !== e2.hungUp && ke.encode(e2.hungUp, n2.uint32(42).fork()).join(), void 0 !== e2.reject && ge.encode(e2.reject, n2.uint32(50).fork()).join(), void 0 !== e2.getTokenByRoomID && le.encode(e2.getTokenByRoomID, n2.uint32(58).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invite: void 0, inviteInGroup: void 0, cancel: void 0, accept: void 0, hungUp: void 0, reject: void 0, getTokenByRoomID: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invite = ce.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.inviteInGroup = de.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.cancel = ve.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.accept = pe.decode(i2, i2.uint32());
              continue;
            case 5:
              if (42 !== r2) break;
              o2.hungUp = ke.decode(i2, i2.uint32());
              continue;
            case 6:
              if (50 !== r2) break;
              o2.reject = ge.decode(i2, i2.uint32());
              continue;
            case 7:
              if (58 !== r2) break;
              o2.getTokenByRoomID = le.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var de = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.token && n2.uint32(10).string(e2.token), "" !== e2.roomID && n2.uint32(18).string(e2.roomID), "" !== e2.liveURL && n2.uint32(26).string(e2.liveURL);
        for (var i2, t2 = s(e2.busyLineUserIDList); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(34).string(o2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { token: "", roomID: "", liveURL: "", busyLineUserIDList: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.token = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.liveURL = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.busyLineUserIDList.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ve = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2; i2.pos < t2; ) {
          var o2 = i2.uint32();
          if (4 == (7 & o2) || 0 === o2) break;
          i2.skip(7 & o2);
        }
        return {};
      } };
      var pe = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.token && n2.uint32(10).string(e2.token), "" !== e2.roomID && n2.uint32(18).string(e2.roomID), "" !== e2.liveURL && n2.uint32(26).string(e2.liveURL), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { token: "", roomID: "", liveURL: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.token = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.liveURL = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ke = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2; i2.pos < t2; ) {
          var o2 = i2.uint32();
          if (4 == (7 & o2) || 0 === o2) break;
          i2.skip(7 & o2);
        }
        return {};
      } };
      var ge = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2; i2.pos < t2; ) {
          var o2 = i2.uint32();
          if (4 == (7 & o2) || 0 === o2) break;
          i2.skip(7 & o2);
        }
        return {};
      } };
      var le = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.token && n2.uint32(10).string(e2.token), "" !== e2.liveURL && n2.uint32(18).string(e2.liveURL), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { token: "", liveURL: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.token = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.liveURL = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var be = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.signalResp && fe.encode(e2.signalResp, n2.uint32(10).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { signalResp: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.signalResp = fe.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var he = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(26).fork()).join(), "" !== e2.userID && n2.uint32(34).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, participant: void 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Ie = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(26).fork()).join(), "" !== e2.userID && n2.uint32(34).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, participant: void 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var De = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(26).fork()).join(), "" !== e2.userID && n2.uint32(34).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, participant: void 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var we = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(26).fork()).join(), 0 !== e2.opUserPlatformID && n2.uint32(32).int32(e2.opUserPlatformID), "" !== e2.userID && n2.uint32(42).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, participant: void 0, opUserPlatformID: 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 4:
              if (32 !== r2) break;
              o2.opUserPlatformID = i2.int32();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var me = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), "" !== e2.userID && n2.uint32(26).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var ye = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join(), void 0 !== e2.offlinePushInfo && j.encode(e2.offlinePushInfo, n2.uint32(18).fork()).join(), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(26).fork()).join(), 0 !== e2.opUserPlatformID && n2.uint32(32).int32(e2.opUserPlatformID), "" !== e2.userID && n2.uint32(42).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, offlinePushInfo: void 0, participant: void 0, opUserPlatformID: 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.offlinePushInfo = j.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 4:
              if (32 !== r2) break;
              o2.opUserPlatformID = i2.int32();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Ue = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.roomID && n2.uint32(10).string(e2.roomID), void 0 !== e2.participant && Re.encode(e2.participant, n2.uint32(18).fork()).join(), "" !== e2.userID && n2.uint32(26).string(e2.userID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { roomID: "", participant: void 0, userID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.participant = Re.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.userID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Se = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.inviterUserID && n2.uint32(10).string(e2.inviterUserID);
        for (var i2, t2 = s(e2.inviteeUserIDList); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(18).string(o2);
        }
        "" !== e2.customData && n2.uint32(26).string(e2.customData), "" !== e2.groupID && n2.uint32(34).string(e2.groupID), "" !== e2.roomID && n2.uint32(42).string(e2.roomID), 0 !== e2.timeout && n2.uint32(48).int32(e2.timeout), "" !== e2.mediaType && n2.uint32(58).string(e2.mediaType), 0 !== e2.platformID && n2.uint32(64).int32(e2.platformID), 0 !== e2.sessionType && n2.uint32(72).int32(e2.sessionType), 0 !== e2.initiateTime && n2.uint32(80).int64(e2.initiateTime);
        for (var r2, u2 = s(e2.busyLineUserIDList); !(r2 = u2()).done; ) {
          var a2 = r2.value;
          n2.uint32(90).string(a2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { inviterUserID: "", inviteeUserIDList: [], customData: "", groupID: "", roomID: "", timeout: 0, mediaType: "", platformID: 0, sessionType: 0, initiateTime: 0, busyLineUserIDList: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.inviterUserID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.inviteeUserIDList.push(i2.string());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.customData = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.groupID = i2.string();
              continue;
            case 5:
              if (42 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 6:
              if (48 !== r2) break;
              o2.timeout = i2.int32();
              continue;
            case 7:
              if (58 !== r2) break;
              o2.mediaType = i2.string();
              continue;
            case 8:
              if (64 !== r2) break;
              o2.platformID = i2.int32();
              continue;
            case 9:
              if (72 !== r2) break;
              o2.sessionType = i2.int32();
              continue;
            case 10:
              if (80 !== r2) break;
              o2.initiateTime = M(i2.int64());
              continue;
            case 11:
              if (90 !== r2) break;
              o2.busyLineUserIDList.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Re = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.groupInfo && Z.encode(e2.groupInfo, n2.uint32(10).fork()).join(), void 0 !== e2.groupMemberInfo && Te.encode(e2.groupMemberInfo, n2.uint32(18).fork()).join(), void 0 !== e2.userInfo && Me.encode(e2.userInfo, n2.uint32(26).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { groupInfo: void 0, groupMemberInfo: void 0, userInfo: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.groupInfo = Z.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.groupMemberInfo = Te.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.userInfo = Me.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Te = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.groupID && n2.uint32(10).string(e2.groupID), "" !== e2.userID && n2.uint32(18).string(e2.userID), 0 !== e2.roleLevel && n2.uint32(24).int32(e2.roleLevel), 0 !== e2.joinTime && n2.uint32(32).int64(e2.joinTime), "" !== e2.nickname && n2.uint32(42).string(e2.nickname), "" !== e2.faceURL && n2.uint32(50).string(e2.faceURL), 0 !== e2.appMangerLevel && n2.uint32(56).int32(e2.appMangerLevel), 0 !== e2.joinSource && n2.uint32(64).int32(e2.joinSource), "" !== e2.operatorUserID && n2.uint32(74).string(e2.operatorUserID), "" !== e2.ex && n2.uint32(82).string(e2.ex), 0 !== e2.muteEndTime && n2.uint32(88).int64(e2.muteEndTime), "" !== e2.inviterUserID && n2.uint32(98).string(e2.inviterUserID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { groupID: "", userID: "", roleLevel: 0, joinTime: 0, nickname: "", faceURL: "", appMangerLevel: 0, joinSource: 0, operatorUserID: "", ex: "", muteEndTime: 0, inviterUserID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.groupID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 3:
              if (24 !== r2) break;
              o2.roleLevel = i2.int32();
              continue;
            case 4:
              if (32 !== r2) break;
              o2.joinTime = M(i2.int64());
              continue;
            case 5:
              if (42 !== r2) break;
              o2.nickname = i2.string();
              continue;
            case 6:
              if (50 !== r2) break;
              o2.faceURL = i2.string();
              continue;
            case 7:
              if (56 !== r2) break;
              o2.appMangerLevel = i2.int32();
              continue;
            case 8:
              if (64 !== r2) break;
              o2.joinSource = i2.int32();
              continue;
            case 9:
              if (74 !== r2) break;
              o2.operatorUserID = i2.string();
              continue;
            case 10:
              if (82 !== r2) break;
              o2.ex = i2.string();
              continue;
            case 11:
              if (88 !== r2) break;
              o2.muteEndTime = M(i2.int64());
              continue;
            case 12:
              if (98 !== r2) break;
              o2.inviterUserID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Me = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID), "" !== e2.nickname && n2.uint32(18).string(e2.nickname), "" !== e2.faceURL && n2.uint32(26).string(e2.faceURL), "" !== e2.ex && n2.uint32(34).string(e2.ex), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", nickname: "", faceURL: "", ex: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.nickname = i2.string();
              continue;
            case 3:
              if (26 !== r2) break;
              o2.faceURL = i2.string();
              continue;
            case 4:
              if (34 !== r2) break;
              o2.ex = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var je = { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), void 0 !== e2.invite && he.encode(e2.invite, n2.uint32(10).fork()).join(), void 0 !== e2.inviteInGroup && Ie.encode(e2.inviteInGroup, n2.uint32(18).fork()).join(), void 0 !== e2.cancel && De.encode(e2.cancel, n2.uint32(26).fork()).join(), void 0 !== e2.accept && we.encode(e2.accept, n2.uint32(34).fork()).join(), void 0 !== e2.hungUp && me.encode(e2.hungUp, n2.uint32(42).fork()).join(), void 0 !== e2.reject && ye.encode(e2.reject, n2.uint32(50).fork()).join(), void 0 !== e2.getTokenByRoomID && Ue.encode(e2.getTokenByRoomID, n2.uint32(58).fork()).join(), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invite: void 0, inviteInGroup: void 0, cancel: void 0, accept: void 0, hungUp: void 0, reject: void 0, getTokenByRoomID: void 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invite = he.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.inviteInGroup = Ie.decode(i2, i2.uint32());
              continue;
            case 3:
              if (26 !== r2) break;
              o2.cancel = De.decode(i2, i2.uint32());
              continue;
            case 4:
              if (34 !== r2) break;
              o2.accept = we.decode(i2, i2.uint32());
              continue;
            case 5:
              if (42 !== r2) break;
              o2.hungUp = me.decode(i2, i2.uint32());
              continue;
            case 6:
              if (50 !== r2) break;
              o2.reject = ye.decode(i2, i2.uint32());
              continue;
            case 7:
              if (58 !== r2) break;
              o2.getTokenByRoomID = Ue.decode(i2, i2.uint32());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var Pe = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join();
        for (var i2, t2 = s(e2.participant); !(i2 = t2()).done; ) Re.encode(i2.value, n2.uint32(18).fork()).join();
        return "" !== e2.groupID && n2.uint32(26).string(e2.groupID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, participant: [], groupID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.participant.push(Re.decode(i2, i2.uint32()));
              continue;
            case 3:
              if (26 !== r2) break;
              o2.groupID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var xe = { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), void 0 !== e2.invitation && Se.encode(e2.invitation, n2.uint32(10).fork()).join();
        for (var i2, t2 = s(e2.participant); !(i2 = t2()).done; ) Re.encode(i2.value, n2.uint32(18).fork()).join();
        return "" !== e2.groupID && n2.uint32(26).string(e2.groupID), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { invitation: void 0, participant: [], groupID: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.invitation = Se.decode(i2, i2.uint32());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.participant.push(Re.decode(i2, i2.uint32()));
              continue;
            case 3:
              if (26 !== r2) break;
              o2.groupID = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } };
      var qe = { __proto__: null, OfflinePushInfo: j, MsgData_OptionsEntry: P, MsgData: x, SeqRange: q, PullMessageBySeqsReq: E, SubUserOnlineStatus: { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U());
        for (var i2, t2 = s(e2.subscribeUserID); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(10).string(o2);
        }
        for (var r2, u2 = s(e2.unsubscribeUserID); !(r2 = u2()).done; ) {
          var a2 = r2.value;
          n2.uint32(18).string(a2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { subscribeUserID: [], unsubscribeUserID: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.subscribeUserID.push(i2.string());
              continue;
            case 2:
              if (18 !== r2) break;
              o2.unsubscribeUserID.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, GetMaxSeqResp_MaxSeqsEntry: L, GetMaxSeqResp_MinSeqsEntry: _, GetMaxSeqResp: B, PullMessageBySeqsResp: A, PullMessageBySeqsResp_MsgsEntry: O, PullMessageBySeqsResp_NotificationMsgsEntry: C, PullMsgs: G, UserSendMsgResp: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.serverMsgID && n2.uint32(10).string(e2.serverMsgID), "" !== e2.clientMsgID && n2.uint32(18).string(e2.clientMsgID), 0 !== e2.sendTime && n2.uint32(24).int64(e2.sendTime), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { serverMsgID: "", clientMsgID: "", sendTime: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.serverMsgID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.clientMsgID = i2.string();
              continue;
            case 3:
              if (24 !== r2) break;
              o2.sendTime = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, PushMessages: N, PushMessages_MsgsEntry: F, PushMessages_NotificationMsgsEntry: V, SetAppBackgroundStatusResp: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2; i2.pos < t2; ) {
          var o2 = i2.uint32();
          if (4 == (7 & o2) || 0 === o2) break;
          i2.skip(7 & o2);
        }
        return {};
      } }, SubUserOnlineStatusElem: H, SubUserOnlineStatusTips: $, ServerConfig: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), false !== e2.isEncryption && n2.uint32(8).bool(e2.isEncryption), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { isEncryption: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (8 !== r2) break;
              o2.isEncryption = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, GetActiveConversationsReq: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.ownerUserID && n2.uint32(10).string(e2.ownerUserID), 0 !== e2.count && n2.uint32(16).int64(e2.count), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { ownerUserID: "", count: 0 }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.ownerUserID = i2.string();
              continue;
            case 2:
              if (16 !== r2) break;
              o2.count = M(i2.int64());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, GetConversationsReq: { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.ownerUserID && n2.uint32(10).string(e2.ownerUserID);
        for (var i2, t2 = s(e2.conversationIDs); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(18).string(o2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { ownerUserID: "", conversationIDs: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.ownerUserID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversationIDs.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, Conversation: z, UserInfo: W, FriendInfoOnly: X, GroupInfo: Z, ConversationMsg: J, GetActiveConversationsResp: K, GetConversationsResp: Q, GetConversationsHasReadAndMaxSeqReq: { encode: function(e2, n2) {
        void 0 === n2 && (n2 = new U()), "" !== e2.userID && n2.uint32(10).string(e2.userID);
        for (var i2, t2 = s(e2.conversationIDs); !(i2 = t2()).done; ) {
          var o2 = i2.value;
          n2.uint32(18).string(o2);
        }
        return n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { userID: "", conversationIDs: [] }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.userID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.conversationIDs.push(i2.string());
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, ConversationSeqs: Y, GetSeqMessageReq: ee, GetSeqMessageResp: ne, GetSeqMessageResp_MsgsEntry: ie, GetSeqMessageResp_NotificationMsgsEntry: te, GetConversationsHasReadAndMaxSeqResp: oe, Seqs: re, GetConversationsHasReadAndMaxSeqResp_SeqsEntry: se, MarkGroupMessageReadReq: ue, MarkGroupMessageReadReq_ClientMsgsEntry: ae, SignalInviteResp: ce, SignalResp: fe, SignalInviteInGroupResp: de, SignalCancelResp: ve, SignalAcceptResp: pe, SignalHungUpResp: ke, SignalRejectResp: ge, SignalGetTokenByRoomIDResp: le, SignalMessageAssembleResp: be, SignalInviteReq: he, SignalInviteInGroupReq: Ie, SignalCancelReq: De, SignalAcceptReq: we, SignalHungUpReq: me, SignalRejectReq: ye, SignalGetTokenByRoomIDReq: Ue, InvitationInfo: Se, ParticipantMetaData: Re, GroupMemberFullInfo: Te, PublicUserInfo: Me, SignalReq: je, SignalOnStreamChangeReq: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.roomID && n2.uint32(10).string(e2.roomID), "" !== e2.streamType && n2.uint32(18).string(e2.streamType), false !== e2.mute && n2.uint32(24).bool(e2.mute), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { roomID: "", streamType: "", mute: false }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.streamType = i2.string();
              continue;
            case 3:
              if (24 !== r2) break;
              o2.mute = i2.bool();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } }, SignalOnRoomParticipantDisconnectedReq: Pe, SignalOnRoomParticipantConnectedReq: xe, SignalSendCustomSignalReq: { encode: function(e2, n2) {
        return void 0 === n2 && (n2 = new U()), "" !== e2.roomID && n2.uint32(10).string(e2.roomID), "" !== e2.customInfo && n2.uint32(18).string(e2.customInfo), n2;
      }, decode: function(e2, n2) {
        for (var i2 = e2 instanceof S ? e2 : new S(e2), t2 = void 0 === n2 ? i2.len : i2.pos + n2, o2 = { roomID: "", customInfo: "" }; i2.pos < t2; ) {
          var r2 = i2.uint32();
          switch (r2 >>> 3) {
            case 1:
              if (10 !== r2) break;
              o2.roomID = i2.string();
              continue;
            case 2:
              if (18 !== r2) break;
              o2.customInfo = i2.string();
              continue;
          }
          if (4 == (7 & r2) || 0 === r2) break;
          i2.skip(7 & r2);
        }
        return o2;
      } } };
      exports.ConversationProto = { __proto__: null, protobufPackage: "openim.conversation" }, exports.EncryptionProto = { __proto__: null, protobufPackage: "openim.encryption" }, exports.ExtendMsgProto = { __proto__: null, protobufPackage: "openim.extendMsg" }, exports.GroupProto = { __proto__: null, protobufPackage: "openim.group" }, exports.JsSdkProto = { __proto__: null, protobufPackage: "openim.jssdk" }, exports.MsgProto = { __proto__: null, protobufPackage: "openim.msg" }, exports.PbCoder = qe, exports.RelationProto = { __proto__: null, protobufPackage: "openim.relation" }, exports.RtcProto = { __proto__: null, protobufPackage: "openim.rtc" }, exports.SdkWsProto = o, exports.UserProto = { __proto__: null, protobufPackage: "openim.user" }, exports.WrapperspbProto = { __proto__: null, protobufPackage: "openim.protobuf" };
    }
  });

  // node_modules/@openim/protocol/lib/pb/sdkws/sdkws.js
  var require_sdkws = __commonJS({
    "node_modules/@openim/protocol/lib/pb/sdkws/sdkws.js"(exports) {
      (function(e) {
        e[e.PullOrderAsc = 0] = "PullOrderAsc";
        e[e.PullOrderDesc = 1] = "PullOrderDesc";
        e[e.UNRECOGNIZED = -1] = "UNRECOGNIZED";
      })(exports.PullOrder = {});
      Object.defineProperty(exports, "__esModule", { value: true });
    }
  });

  // node_modules/@openim/client-sdk/lib/index.js
  var require_lib2 = __commonJS({
    "node_modules/@openim/client-sdk/lib/index.js"(exports) {
      var e = require_loglevel();
      var t = require_spark_md5();
      var r = require_base64_arraybuffer_umd();
      var n = require_lib();
      var o = require_sdkws();
      function i(e2) {
        return e2 && "object" == typeof e2 && "default" in e2 ? e2 : { default: e2 };
      }
      var s = /* @__PURE__ */ i(e);
      var a = /* @__PURE__ */ i(t);
      function u(e2, t2) {
        (null == t2 || t2 > e2.length) && (t2 = e2.length);
        for (var r2 = 0, n2 = Array(t2); r2 < t2; r2++) n2[r2] = e2[r2];
        return n2;
      }
      function c(e2, t2) {
        if (!{}.hasOwnProperty.call(e2, t2)) throw new TypeError("attempted to use private field on non-instance");
        return e2;
      }
      var d = 0;
      function p(e2) {
        return "__private_" + d++ + "_" + e2;
      }
      function g(e2, t2) {
        var r2 = "undefined" != typeof Symbol && e2[Symbol.iterator] || e2["@@iterator"];
        if (r2) return (r2 = r2.call(e2)).next.bind(r2);
        if (Array.isArray(e2) || (r2 = (function(e3, t3) {
          if (e3) {
            if ("string" == typeof e3) return u(e3, t3);
            var r3 = {}.toString.call(e3).slice(8, -1);
            return "Object" === r3 && e3.constructor && (r3 = e3.constructor.name), "Map" === r3 || "Set" === r3 ? Array.from(e3) : "Arguments" === r3 || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r3) ? u(e3, t3) : void 0;
          }
        })(e2)) || t2 && e2 && "number" == typeof e2.length) {
          r2 && (e2 = r2);
          var n2 = 0;
          return function() {
            return n2 >= e2.length ? { done: true } : { done: false, value: e2[n2++] };
          };
        }
        throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }
      function l() {
        return l = Object.assign ? Object.assign.bind() : function(e2) {
          for (var t2 = 1; t2 < arguments.length; t2++) {
            var r2 = arguments[t2];
            for (var n2 in r2) ({}).hasOwnProperty.call(r2, n2) && (e2[n2] = r2[n2]);
          }
          return e2;
        }, l.apply(null, arguments);
      }
      function f(e2) {
        return f = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(e3) {
          return e3.__proto__ || Object.getPrototypeOf(e3);
        }, f(e2);
      }
      function v(e2, t2) {
        e2.prototype = Object.create(t2.prototype), e2.prototype.constructor = e2, I(e2, t2);
      }
      function h() {
        try {
          var e2 = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
          }));
        } catch (e3) {
        }
        return (h = function() {
          return !!e2;
        })();
      }
      function m(e2, t2) {
        if (null == e2) return {};
        var r2 = {};
        for (var n2 in e2) if ({}.hasOwnProperty.call(e2, n2)) {
          if (t2.includes(n2)) continue;
          r2[n2] = e2[n2];
        }
        return r2;
      }
      function I(e2, t2) {
        return I = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(e3, t3) {
          return e3.__proto__ = t3, e3;
        }, I(e2, t2);
      }
      function M(e2) {
        var t2 = "function" == typeof Map ? /* @__PURE__ */ new Map() : void 0;
        return M = function(e3) {
          if (null === e3 || !(function(e4) {
            try {
              return -1 !== Function.toString.call(e4).indexOf("[native code]");
            } catch (t3) {
              return "function" == typeof e4;
            }
          })(e3)) return e3;
          if ("function" != typeof e3) throw new TypeError("Super expression must either be null or a function");
          if (void 0 !== t2) {
            if (t2.has(e3)) return t2.get(e3);
            t2.set(e3, r2);
          }
          function r2() {
            return (function(e4, t3, r3) {
              if (h()) return Reflect.construct.apply(null, arguments);
              var n2 = [null];
              n2.push.apply(n2, t3);
              var o2 = new (e4.bind.apply(e4, n2))();
              return r3 && I(o2, r3.prototype), o2;
            })(e3, arguments, f(this).constructor);
          }
          return r2.prototype = Object.create(e3.prototype, { constructor: { value: r2, enumerable: false, writable: true, configurable: true } }), I(r2, e3);
        }, M(e2);
      }
      var y;
      var D;
      var C;
      var S = function(e2) {
        try {
          if (!e2.ok) throw new Error(e2.statusText);
          return Promise.resolve(e2.json()).then(function(e3) {
            if (0 !== e3.errCode) throw new Error(e3.errMsg);
            return e3.data;
          });
        } catch (e3) {
          return Promise.reject(e3);
        }
      };
      var T = { txt: "text/plain", html: "text/html", css: "text/css", js: "text/javascript", json: "application/json", csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", mp3: "audio/mpeg", mp4: "video/mp4", wav: "audio/wav", pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xml: "application/xml", zip: "application/zip", tar: "application/x-tar", "7z": "application/x-7z-compressed", rar: "application/vnd.rar", ogg: "audio/ogg", midi: "audio/midi", webm: "audio/webm", avi: "video/x-msvideo", mpeg: "video/mpeg", ts: "video/mp2t", mov: "video/quicktime", wmv: "video/x-ms-wmv", flv: "video/x-flv", mkv: "video/x-matroska", webp: "image/webp", heic: "image/heic", psd: "image/vnd.adobe.photoshop", ai: "application/postscript", eps: "application/postscript", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", jsonld: "application/ld+json", ics: "text/calendar", sh: "application/x-sh", php: "application/x-httpd-php", jar: "application/java-archive" };
      exports.RequestApi = void 0, (D = exports.RequestApi || (exports.RequestApi = {})).InitSDK = "InitSDK", D.Login = "Login", D.Logout = "Logout", D.GetLoginStatus = "GetLoginStatus", D.GetLoginUserID = "GetLoginUserID", D.ForceReconnect = "ForceReconnect", D.GetSelfUserInfo = "GetSelfUserInfo", D.SetSelfInfo = "SetSelfInfo", D.GetUsersInfo = "GetUsersInfo", D.SubscribeUsersStatus = "SubscribeUsersStatus", D.UnsubscribeUsersStatus = "UnsubscribeUsersStatus", D.GetSubscribeUsersStatus = "GetSubscribeUsersStatus", D.SetAppBackgroundStatus = "SetAppBackgroundStatus", D.NetworkStatusChanged = "NetworkStatusChanged", D.SetGlobalRecvMessageOpt = "SetGlobalRecvMessageOpt", D.AcceptFriendApplication = "AcceptFriendApplication", D.AddBlack = "AddBlack", D.AddFriend = "AddFriend", D.CheckFriend = "CheckFriend", D.DeleteFriend = "DeleteFriend", D.GetBlackList = "GetBlackList", D.GetFriendApplicationListAsApplicant = "GetFriendApplicationListAsApplicant", D.GetFriendApplicationListAsRecipient = "GetFriendApplicationListAsRecipient", D.GetFriendList = "GetFriendList", D.GetFriendListPage = "GetFriendListPage", D.GetSpecifiedFriendsInfo = "GetSpecifiedFriendsInfo", D.RefuseFriendApplication = "RefuseFriendApplication", D.RemoveBlack = "RemoveBlack", D.SearchFriends = "SearchFriends", D.UpdateFriends = "UpdateFriends", D.CreateGroup = "CreateGroup", D.JoinGroup = "JoinGroup", D.InviteUserToGroup = "InviteUserToGroup", D.GetJoinedGroupList = "GetJoinedGroupList", D.GetJoinedGroupListPage = "GetJoinedGroupListPage", D.SearchGroups = "SearchGroups", D.GetSpecifiedGroupsInfo = "GetSpecifiedGroupsInfo", D.SetGroupInfo = "SetGroupInfo", D.GetGroupApplicationListAsRecipient = "GetGroupApplicationListAsRecipient", D.GetGroupApplicationListAsApplicant = "GetGroupApplicationListAsApplicant", D.AcceptGroupApplication = "AcceptGroupApplication", D.RefuseGroupApplication = "RefuseGroupApplication", D.GetGroupMemberList = "GetGroupMemberList", D.GetSpecifiedGroupMembersInfo = "GetSpecifiedGroupMembersInfo", D.SearchGroupMembers = "SearchGroupMembers", D.SetGroupMemberInfo = "SetGroupMemberInfo", D.GetGroupMemberOwnerAndAdmin = "GetGroupMemberOwnerAndAdmin", D.GetGroupMemberListByJoinTimeFilter = "GetGroupMemberListByJoinTimeFilter", D.KickGroupMember = "KickGroupMember", D.ChangeGroupMemberMute = "ChangeGroupMemberMute", D.ChangeGroupMute = "ChangeGroupMute", D.TransferGroupOwner = "TransferGroupOwner", D.DismissGroup = "DismissGroup", D.QuitGroup = "QuitGroup", D.GetUsersInGroup = "GetUsersInGroup", D.IsJoinGroup = "IsJoinGroup", D.GetAllConversationList = "GetAllConversationList", D.GetConversationListSplit = "GetConversationListSplit", D.GetOneConversation = "GetOneConversation", D.GetMultipleConversation = "GetMultipleConversation", D.GetConversationIDBySessionType = "GetConversationIDBySessionType", D.GetTotalUnreadMsgCount = "GetTotalUnreadMsgCount", D.MarkConversationMessageAsRead = "MarkConversationMessageAsRead", D.SetConversationDraft = "SetConversationDraft", D.PinConversation = "PinConversation", D.SetConversationRecvMessageOpt = "SetConversationRecvMessageOpt", D.SetConversationPrivateChat = "SetConversationPrivateChat", D.SetConversationBurnDuration = "SetConversationBurnDuration", D.ResetConversationGroupAtType = "ResetConversationGroupAtType", D.HideConversation = "HideConversation", D.HideAllConversation = "HideAllConversation", D.ClearConversationAndDeleteAllMsg = "ClearConversationAndDeleteAllMsg", D.DeleteConversationAndDeleteAllMsg = "DeleteConversationAndDeleteAllMsg", D.ChangeInputStates = "ChangeInputStates", D.GetInputStates = "GetInputStates", D.CreateTextMessage = "CreateTextMessage", D.CreateTextAtMessage = "CreateTextAtMessage", D.CreateImageMessageByFile = "CreateImageMessageByFile", D.CreateImageMessageByURL = "CreateImageMessageByURL", D.CreateSoundMessageByFile = "CreateSoundMessageByFile", D.CreateSoundMessageByURL = "CreateSoundMessageByURL", D.CreateVideoMessageByFile = "CreateVideoMessageByFile", D.CreateVideoMessageByURL = "CreateVideoMessageByURL", D.CreateFileMessageByFile = "CreateFileMessageByFile", D.CreateFileMessageByURL = "CreateFileMessageByURL", D.CreateMergerMessage = "CreateMergerMessage", D.CreateForwardMessage = "CreateForwardMessage", D.CreateLocationMessage = "CreateLocationMessage", D.CreateQuoteMessage = "CreateQuoteMessage", D.CreateCardMessage = "CreateCardMessage", D.CreateCustomMessage = "CreateCustomMessage", D.CreateFaceMessage = "CreateFaceMessage", D.SendMessage = "SendMessage", D.SendMessageNotOss = "SendMessageNotOss", D.UploadFile = "UploadFile", D.TypingStatusUpdate = "TypingStatusUpdate", D.RevokeMessage = "RevokeMessage", D.DeleteMessage = "DeleteMessage", D.DeleteMessageFromLocalStorage = "DeleteMessageFromLocalStorage", D.DeleteAllMsgFromLocal = "DeleteAllMsgFromLocal", D.DeleteAllMsgFromLocalAndSvr = "DeleteAllMsgFromLocalAndSvr", D.SearchLocalMessages = "SearchLocalMessages", D.GetAdvancedHistoryMessageList = "GetAdvancedHistoryMessageList", D.GetAdvancedHistoryMessageListReverse = "GetAdvancedHistoryMessageListReverse", D.FindMessageList = "FindMessageList", D.InsertGroupMessageToLocalStorage = "InsertGroupMessageToLocalStorage", D.InsertSingleMessageToLocalStorage = "InsertSingleMessageToLocalStorage", D.SetMessageLocalEx = "SetMessageLocalEx", D.SetConversation = "SetConversation", (function(e2) {
        e2.GetFriendVersion = "GetFriendVersion", e2.GetGroupVersion = "GetGroupVersion", e2.GetJoinedGroupIDList = "GetJoinedGroupIDList", e2.GetGroupMemberVersion = "GetGroupMemberVersion", e2.GetConversationVersion = "GetConversationVersion", e2.GetConversationsHasReadAndMaxSeq = "GetConversationsHasReadAndMaxSeq", e2.GetDesignatedFriendsApplication = "GetDesignatedFriendsApplication", e2.GetDesignatedGroupApplication = "GetDesignatedGroupApplication", e2.GetDesignatedBlackUser = "GetDesignatedBlackUser", e2.GetActiveConversations = "GetActiveConversations", e2.GetDesignatedConversation = "GetDesignatedConversation", e2.GetNotNotifyConversationIDs = "GetNotNotifyConversationIDs", e2.GetFullFriendUserIDs = "GetFullFriendUserIDs", e2.GetFullGroupMemberUserIDs = "GetFullGroupMemberUserIDs";
      })(C || (C = {}));
      var x;
      var b;
      var A;
      var R;
      var P;
      var G;
      var N;
      var q;
      var E;
      var w;
      var U;
      var O;
      var F = ((y = {})[exports.RequestApi.AddFriend] = "/friend/add_friend", y[exports.RequestApi.CheckFriend] = "/friend/is_friend", y[exports.RequestApi.DeleteFriend] = "/friend/delete_friend", y[exports.RequestApi.AcceptFriendApplication] = "/friend/add_friend_response", y[exports.RequestApi.RefuseFriendApplication] = "/friend/add_friend_response", y[exports.RequestApi.GetFriendListPage] = "/friend/get_friend_list", y[exports.RequestApi.GetSpecifiedFriendsInfo] = "/friend/get_designated_friends", y[exports.RequestApi.GetFriendApplicationListAsApplicant] = "/friend/get_self_friend_apply_list", y[exports.RequestApi.GetFriendApplicationListAsRecipient] = "/friend/get_friend_apply_list", y[exports.RequestApi.UpdateFriends] = "/friend/update_friends", y[exports.RequestApi.AddBlack] = "/friend/add_black", y[exports.RequestApi.RemoveBlack] = "/friend/remove_black", y[exports.RequestApi.GetBlackList] = "/friend/get_black_list", y[exports.RequestApi.CreateGroup] = "/group/create_group", y[exports.RequestApi.JoinGroup] = "/group/join_group", y[exports.RequestApi.InviteUserToGroup] = "/group/invite_user_to_group", y[exports.RequestApi.GetJoinedGroupListPage] = "/group/get_joined_group_list", y[exports.RequestApi.GetSpecifiedGroupsInfo] = "/group/get_groups_info", y[exports.RequestApi.SetGroupInfo] = "/group/set_group_info_ex", y[exports.RequestApi.GetGroupApplicationListAsApplicant] = "/group/get_user_req_group_applicationList", y[exports.RequestApi.GetGroupApplicationListAsRecipient] = "/group/get_recv_group_applicationList", y[exports.RequestApi.AcceptGroupApplication] = "/group/group_application_response", y[exports.RequestApi.RefuseGroupApplication] = "/group/group_application_response", y[exports.RequestApi.GetGroupMemberList] = "/group/get_group_member_list", y[exports.RequestApi.GetSpecifiedGroupMembersInfo] = "/group/get_group_members_info", y[exports.RequestApi.SetGroupMemberInfo] = "/group/set_group_member_info", y[exports.RequestApi.KickGroupMember] = "/group/kick_group", y[exports.RequestApi.TransferGroupOwner] = "/group/transfer_group", y[exports.RequestApi.DismissGroup] = "/group/dismiss_group", y[exports.RequestApi.QuitGroup] = "/group/quit_group", y[exports.RequestApi.GetSelfUserInfo] = "/user/get_users_info", y[exports.RequestApi.SetSelfInfo] = "/user/update_user_info_ex", y[exports.RequestApi.GetUsersInfo] = "/user/get_users_info", y[exports.RequestApi.SubscribeUsersStatus] = "/user/subscribe_users_status", y[exports.RequestApi.UnsubscribeUsersStatus] = "/user/subscribe_users_status", y[exports.RequestApi.GetSubscribeUsersStatus] = "/user/get_subscribe_users_status", y[exports.RequestApi.SetGlobalRecvMessageOpt] = "/user/set_global_msg_recv_opt", y[exports.RequestApi.RevokeMessage] = "/msg/revoke_msg", y[exports.RequestApi.DeleteMessage] = "/msg/delete_msgs", y[exports.RequestApi.DeleteConversationAndDeleteAllMsg] = "/msg/clear_conversation_msg", y[exports.RequestApi.DeleteAllMsgFromLocalAndSvr] = "/msg/user_clear_all_msg", y[exports.RequestApi.MarkConversationMessageAsRead] = "/msg/mark_conversation_as_read", y[exports.RequestApi.SetConversation] = "/conversation/set_conversations", y[C.GetFriendVersion] = "/friend/get_incremental_friends", y[C.GetGroupVersion] = "/group/get_incremental_join_groups", y[C.GetJoinedGroupIDList] = "/group/get_full_join_group_ids", y[C.GetGroupMemberVersion] = "/group/get_incremental_group_members_batch", y[C.GetConversationVersion] = "/conversation/get_incremental_conversations", y[C.GetConversationsHasReadAndMaxSeq] = "/conversation/get_conversations_has_read_and_max_seq", y[C.GetDesignatedFriendsApplication] = "/friend/get_designated_friend_apply", y[C.GetDesignatedGroupApplication] = "/group/get_specified_user_group_request_info", y[C.GetDesignatedBlackUser] = "/friend/get_specified_blacks", y[C.GetActiveConversations] = "/jssdk/get_active_conversations", y[C.GetDesignatedConversation] = "/jssdk/get_conversations", y[C.GetNotNotifyConversationIDs] = "/conversation/get_not_notify_conversation_ids", y[C.GetFullFriendUserIDs] = "/friend/get_full_friend_user_ids", y[C.GetFullGroupMemberUserIDs] = "/group/get_full_group_member_user_ids", y);
      exports.CbEvents = void 0, (x = exports.CbEvents || (exports.CbEvents = {})).OnConnectFailed = "OnConnectFailed", x.OnConnectSuccess = "OnConnectSuccess", x.OnConnecting = "OnConnecting", x.OnKickedOffline = "OnKickedOffline", x.OnSelfInfoUpdated = "OnSelfInfoUpdated", x.OnUserTokenExpired = "OnUserTokenExpired", x.OnUserTokenInvalid = "OnUserTokenInvalid", x.OnProgress = "OnProgress", x.OnRecvNewMessage = "OnRecvNewMessage", x.OnRecvNewMessages = "OnRecvNewMessages", x.OnRecvOfflineNewMessage = "onRecvOfflineNewMessage", x.OnRecvOfflineNewMessages = "onRecvOfflineNewMessages", x.OnRecvOnlineOnlyMessage = "OnRecvOnlineOnlyMessage", x.OnRecvOnlineOnlyMessages = "OnRecvOnlineOnlyMessages", x.OnNewRecvMessageRevoked = "OnNewRecvMessageRevoked", x.OnRecvC2CReadReceipt = "OnRecvC2CReadReceipt", x.OnRecvGroupReadReceipt = "OnRecvGroupReadReceipt", x.OnConversationChanged = "OnConversationChanged", x.OnNewConversation = "OnNewConversation", x.OnConversationUserInputStatusChanged = "OnConversationUserInputStatusChanged", x.OnSyncServerFailed = "OnSyncServerFailed", x.OnSyncServerFinish = "OnSyncServerFinish", x.OnSyncServerProgress = "OnSyncServerProgress", x.OnSyncServerStart = "OnSyncServerStart", x.OnTotalUnreadMessageCountChanged = "OnTotalUnreadMessageCountChanged", x.OnBlackAdded = "OnBlackAdded", x.OnBlackDeleted = "OnBlackDeleted", x.OnFriendApplicationAccepted = "OnFriendApplicationAccepted", x.OnFriendApplicationAdded = "OnFriendApplicationAdded", x.OnFriendApplicationDeleted = "OnFriendApplicationDeleted", x.OnFriendApplicationRejected = "OnFriendApplicationRejected", x.OnFriendInfoChanged = "OnFriendInfoChanged", x.OnFriendAdded = "OnFriendAdded", x.OnFriendDeleted = "OnFriendDeleted", x.OnJoinedGroupAdded = "OnJoinedGroupAdded", x.OnJoinedGroupDeleted = "OnJoinedGroupDeleted", x.OnGroupDismissed = "OnGroupDismissed", x.OnGroupMemberAdded = "OnGroupMemberAdded", x.OnGroupMemberDeleted = "OnGroupMemberDeleted", x.OnGroupApplicationAdded = "OnGroupApplicationAdded", x.OnGroupApplicationDeleted = "OnGroupApplicationDeleted", x.OnGroupInfoChanged = "OnGroupInfoChanged", x.OnGroupMemberInfoChanged = "OnGroupMemberInfoChanged", x.OnGroupApplicationAccepted = "OnGroupApplicationAccepted", x.OnGroupApplicationRejected = "OnGroupApplicationRejected", x.UploadComplete = "UploadComplete", x.OnRecvCustomBusinessMessage = "OnRecvCustomBusinessMessage", x.OnUserStatusChanged = "OnUserStatusChanged", x.OnUploadLogsProgress = "OnUploadLogsProgress", x.OnReceiveNewInvitation = "OnReceiveNewInvitation", x.OnInviteeAccepted = "OnInviteeAccepted", x.OnInviteeRejected = "OnInviteeRejected", x.OnInvitationCancelled = "OnInvitationCancelled", x.OnHangUp = "OnHangUp", x.OnInvitationTimeout = "OnInvitationTimeout", x.OnInviteeAcceptedByOtherDevice = "OnInviteeAcceptedByOtherDevice", x.OnInviteeRejectedByOtherDevice = "OnInviteeRejectedByOtherDevice", x.OnStreamChange = "OnStreamChange", x.OnRoomParticipantConnected = "OnRoomParticipantConnected", x.OnRoomParticipantDisconnected = "OnRoomParticipantDisconnected", x.OnReceiveCustomSignal = "OnReceiveCustomSignal", x.UnUsedEvent = "UnUsedEvent", exports.ErrorCode = void 0, (A = exports.ErrorCode || (exports.ErrorCode = {}))[A.NetworkError = 1e4] = "NetworkError", A[A.NetworkTimeoutError = 10001] = "NetworkTimeoutError", A[A.ArgsError = 10002] = "ArgsError", A[A.CtxDeadlineExceededError = 10003] = "CtxDeadlineExceededError", A[A.ResourceLoadNotCompleteError = 10004] = "ResourceLoadNotCompleteError", A[A.UnknownCode = 10005] = "UnknownCode", A[A.SdkInternalError = 10006] = "SdkInternalError", A[A.NoUpdateError = 10007] = "NoUpdateError", A[A.UserIDNotFoundError = 10100] = "UserIDNotFoundError", A[A.LoginOutError = 10101] = "LoginOutError", A[A.LoginRepeatError = 10102] = "LoginRepeatError", A[A.FileNotFoundError = 10200] = "FileNotFoundError", A[A.MsgDeCompressionError = 10201] = "MsgDeCompressionError", A[A.MsgDecodeBinaryWsError = 10202] = "MsgDecodeBinaryWsError", A[A.MsgBinaryTypeNotSupportError = 10203] = "MsgBinaryTypeNotSupportError", A[A.MsgRepeatError = 10204] = "MsgRepeatError", A[A.MsgContentTypeNotSupportError = 10205] = "MsgContentTypeNotSupportError", A[A.MsgHasNoSeqError = 10206] = "MsgHasNoSeqError", A[A.NotSupportOptError = 10301] = "NotSupportOptError", A[A.NotSupportTypeError = 10302] = "NotSupportTypeError", A[A.UnreadCountError = 10303] = "UnreadCountError", A[A.GroupIDNotFoundError = 10400] = "GroupIDNotFoundError", A[A.GroupTypeErr = 10401] = "GroupTypeErr", exports.ReqIdentifier = void 0, (R = exports.ReqIdentifier || (exports.ReqIdentifier = {}))[R.GetNewestSeq = 1001] = "GetNewestSeq", R[R.PullMsgByRange = 1002] = "PullMsgByRange", R[R.SendMsg = 1003] = "SendMsg", R[R.SendSignalMsg = 1004] = "SendSignalMsg", R[R.PullMsgBySeqList = 1005] = "PullMsgBySeqList", R[R.GetConvMaxReadSeq = 1006] = "GetConvMaxReadSeq", R[R.PushMsg = 2001] = "PushMsg", R[R.KickOnlineMsg = 2002] = "KickOnlineMsg", R[R.LogoutMsg = 2003] = "LogoutMsg", R[R.SetBackgroundStatus = 2004] = "SetBackgroundStatus", R[R.WsSubUserOnlineStatus = 2005] = "WsSubUserOnlineStatus", R[R.WSServerConfigMsg = 2100] = "WSServerConfigMsg", R[R.WSDataError = 3001] = "WSDataError", exports.InternalContentType = void 0, (P = exports.InternalContentType || (exports.InternalContentType = {}))[P.Text = 101] = "Text", P[P.Picture = 102] = "Picture", P[P.Sound = 103] = "Sound", P[P.Video = 104] = "Video", P[P.File = 105] = "File", P[P.AtText = 106] = "AtText", P[P.Merger = 107] = "Merger", P[P.Card = 108] = "Card", P[P.Location = 109] = "Location", P[P.Custom = 110] = "Custom", P[P.Typing = 113] = "Typing", P[P.Quote = 114] = "Quote", P[P.Face = 115] = "Face", P[P.AdvancedText = 117] = "AdvancedText", P[P.CustomMsgNotTriggerConversation = 119] = "CustomMsgNotTriggerConversation", P[P.CustomMsgOnlineOnly = 120] = "CustomMsgOnlineOnly", P[P.ReactionMessageModifier = 121] = "ReactionMessageModifier", P[P.ReactionMessageDeleter = 122] = "ReactionMessageDeleter", exports.NotificationType = void 0, (G = exports.NotificationType || (exports.NotificationType = {}))[G.NotificationBegin = 1e3] = "NotificationBegin", G[G.FriendNotificationBegin = 1200] = "FriendNotificationBegin", G[G.FriendApplicationApprovedNotification = 1201] = "FriendApplicationApprovedNotification", G[G.FriendApplicationRejectedNotification = 1202] = "FriendApplicationRejectedNotification", G[G.FriendApplicationNotification = 1203] = "FriendApplicationNotification", G[G.FriendAddedNotification = 1204] = "FriendAddedNotification", G[G.FriendDeletedNotification = 1205] = "FriendDeletedNotification", G[G.FriendRemarkSetNotification = 1206] = "FriendRemarkSetNotification", G[G.BlackAddedNotification = 1207] = "BlackAddedNotification", G[G.BlackDeletedNotification = 1208] = "BlackDeletedNotification", G[G.FriendInfoUpdatedNotification = 1209] = "FriendInfoUpdatedNotification", G[G.FriendsInfoUpdateNotification = 1210] = "FriendsInfoUpdateNotification", G[G.FriendNotificationEnd = 1299] = "FriendNotificationEnd", G[G.ConversationChangeNotification = 1300] = "ConversationChangeNotification", G[G.UserNotificationBegin = 1301] = "UserNotificationBegin", G[G.UserInfoUpdatedNotification = 1303] = "UserInfoUpdatedNotification", G[G.UserStatusChangeNotification = 1304] = "UserStatusChangeNotification", G[G.UserCommandAddNotification = 1305] = "UserCommandAddNotification", G[G.UserCommandDeleteNotification = 1306] = "UserCommandDeleteNotification", G[G.UserCommandUpdateNotification = 1307] = "UserCommandUpdateNotification", G[G.UserNotificationEnd = 1399] = "UserNotificationEnd", G[G.OANotification = 1400] = "OANotification", G[G.GroupNotificationBegin = 1500] = "GroupNotificationBegin", G[G.GroupCreatedNotification = 1501] = "GroupCreatedNotification", G[G.GroupInfoSetNotification = 1502] = "GroupInfoSetNotification", G[G.JoinGroupApplicationNotification = 1503] = "JoinGroupApplicationNotification", G[G.MemberQuitNotification = 1504] = "MemberQuitNotification", G[G.GroupApplicationAcceptedNotification = 1505] = "GroupApplicationAcceptedNotification", G[G.GroupApplicationRejectedNotification = 1506] = "GroupApplicationRejectedNotification", G[G.GroupOwnerTransferredNotification = 1507] = "GroupOwnerTransferredNotification", G[G.MemberKickedNotification = 1508] = "MemberKickedNotification", G[G.MemberInvitedNotification = 1509] = "MemberInvitedNotification", G[G.MemberEnterNotification = 1510] = "MemberEnterNotification", G[G.GroupDismissedNotification = 1511] = "GroupDismissedNotification", G[G.GroupMemberMutedNotification = 1512] = "GroupMemberMutedNotification", G[G.GroupMemberCancelMutedNotification = 1513] = "GroupMemberCancelMutedNotification", G[G.GroupMutedNotification = 1514] = "GroupMutedNotification", G[G.GroupCancelMutedNotification = 1515] = "GroupCancelMutedNotification", G[G.GroupMemberInfoSetNotification = 1516] = "GroupMemberInfoSetNotification", G[G.GroupMemberSetToAdminNotification = 1517] = "GroupMemberSetToAdminNotification", G[G.GroupMemberSetToOrdinaryUserNotification = 1518] = "GroupMemberSetToOrdinaryUserNotification", G[G.GroupInfoSetAnnouncementNotification = 1519] = "GroupInfoSetAnnouncementNotification", G[G.GroupInfoSetNameNotification = 1520] = "GroupInfoSetNameNotification", G[G.GroupNotificationEnd = 1599] = "GroupNotificationEnd", G[G.SignalingNotificationBegin = 1600] = "SignalingNotificationBegin", G[G.SignalingNotification = 1601] = "SignalingNotification", G[G.RoomParticipantsConnectedNotification = 1602] = "RoomParticipantsConnectedNotification", G[G.RoomParticipantsDisconnectedNotification = 1603] = "RoomParticipantsDisconnectedNotification", G[G.StreamChangedNotification = 1604] = "StreamChangedNotification", G[G.CustomSignalNotification = 1605] = "CustomSignalNotification", G[G.SignalingNotificationEnd = 1649] = "SignalingNotificationEnd", G[G.SuperGroupNotificationBegin = 1650] = "SuperGroupNotificationBegin", G[G.SuperGroupUpdateNotification = 1651] = "SuperGroupUpdateNotification", G[G.MsgDeleteNotification = 1652] = "MsgDeleteNotification", G[G.ReactionMessageModifierNotification = 1653] = "ReactionMessageModifierNotification", G[G.ReactionMessageDeleteNotification = 1654] = "ReactionMessageDeleteNotification", G[G.SuperGroupNotificationEnd = 1699] = "SuperGroupNotificationEnd", G[G.ConversationPrivateChatNotification = 1701] = "ConversationPrivateChatNotification", G[G.ConversationUnreadNotification = 1702] = "ConversationUnreadNotification", G[G.ClearConversationNotification = 1703] = "ClearConversationNotification", G[G.WorkMomentNotificationBegin = 1900] = "WorkMomentNotificationBegin", G[G.WorkMomentNotification = 1901] = "WorkMomentNotification", G[G.BusinessNotificationBegin = 2e3] = "BusinessNotificationBegin", G[G.BusinessNotification = 2001] = "BusinessNotification", G[G.BusinessNotificationEnd = 2099] = "BusinessNotificationEnd", G[G.RevokeNotification = 2101] = "RevokeNotification", G[G.HasReadReceiptNotification = 2150] = "HasReadReceiptNotification", G[G.GroupHasReadReceiptNotification = 2155] = "GroupHasReadReceiptNotification", G[G.DeleteMsgsNotification = 2102] = "DeleteMsgsNotification", G[G.HasReadReceipt = 2200] = "HasReadReceipt", G[G.HasGroupReadReceipt = 2300] = "HasGroupReadReceipt", G[G.NotificationEnd = 5e3] = "NotificationEnd", exports.MsgFrom = void 0, (N = exports.MsgFrom || (exports.MsgFrom = {}))[N.UserMsgType = 100] = "UserMsgType", N[N.SysMsgType = 200] = "SysMsgType", exports.InternalMessageStatus = void 0, (q = exports.InternalMessageStatus || (exports.InternalMessageStatus = {}))[q.MsgStatusDefault = 0] = "MsgStatusDefault", q[q.MsgStatusSending = 1] = "MsgStatusSending", q[q.MsgStatusSendSuccess = 2] = "MsgStatusSendSuccess", q[q.MsgStatusSendFailed = 3] = "MsgStatusSendFailed", q[q.MsgStatusHasDeleted = 4] = "MsgStatusHasDeleted", q[q.MsgStatusFiltered = 5] = "MsgStatusFiltered", exports.MessageOptionsKey = void 0, (E = exports.MessageOptionsKey || (exports.MessageOptionsKey = {})).IsHistory = "history", E.IsPersistent = "persistent", E.IsUnreadCount = "unreadCount", E.IsConversationUpdate = "conversationUpdate", E.IsOfflinePush = "offlinePush", E.IsSenderSync = "senderSync", E.IsNotPrivate = "notPrivate", E.IsSenderConversationUpdate = "senderConversationUpdate", exports.GroupStatus = void 0, (w = exports.GroupStatus || (exports.GroupStatus = {}))[w.GroupOk = 0] = "GroupOk", w[w.GroupBanChat = 1] = "GroupBanChat", w[w.GroupStatusDismissed = 2] = "GroupStatusDismissed", w[w.GroupStatusMuted = 3] = "GroupStatusMuted", exports.WorkMomentSdkNotificationType = void 0, (U = exports.WorkMomentSdkNotificationType || (exports.WorkMomentSdkNotificationType = {}))[U.WorkMomentCommentNotification = 0] = "WorkMomentCommentNotification", U[U.WorkMomentLikeNotification = 1] = "WorkMomentLikeNotification", U[U.WorkMomentAtUserNotification = 2] = "WorkMomentAtUserNotification", exports.WsErrorCode = void 0, (O = exports.WsErrorCode || (exports.WsErrorCode = {}))[O.TokenExpiredError = 1501] = "TokenExpiredError", O[O.TokenInvalidError = 1502] = "TokenInvalidError", O[O.TokenMalformedError = 1503] = "TokenMalformedError", O[O.TokenNotValidYetError = 1504] = "TokenNotValidYetError", O[O.TokenUnknownError = 1505] = "TokenUnknownError", O[O.TokenKickedError = 1506] = "TokenKickedError", O[O.TokenNotExistError = 1507] = "TokenNotExistError";
      var k;
      var L;
      var j;
      var B;
      var V;
      var _;
      var H;
      var J;
      var W;
      var K;
      var Q;
      var z;
      var Y;
      var X;
      var $;
      var Z;
      var ee;
      var te;
      var re;
      var ne = ((b = {})[exports.WsErrorCode.TokenExpiredError] = exports.CbEvents.OnUserTokenExpired, b[exports.WsErrorCode.TokenInvalidError] = exports.CbEvents.OnUserTokenInvalid, b[exports.WsErrorCode.TokenMalformedError] = exports.CbEvents.OnUserTokenInvalid, b[exports.WsErrorCode.TokenNotValidYetError] = exports.CbEvents.OnUserTokenInvalid, b[exports.WsErrorCode.TokenUnknownError] = exports.CbEvents.OnUserTokenInvalid, b[exports.WsErrorCode.TokenKickedError] = exports.CbEvents.OnKickedOffline, b[exports.WsErrorCode.TokenNotExistError] = exports.CbEvents.OnUserTokenInvalid, b);
      exports.MessageReceiveOptType = void 0, (k = exports.MessageReceiveOptType || (exports.MessageReceiveOptType = {}))[k.Nomal = 0] = "Nomal", k[k.NotReceive = 1] = "NotReceive", k[k.NotNotify = 2] = "NotNotify", exports.AllowType = void 0, (L = exports.AllowType || (exports.AllowType = {}))[L.Allowed = 0] = "Allowed", L[L.NotAllowed = 1] = "NotAllowed", exports.GroupType = void 0, (j = exports.GroupType || (exports.GroupType = {}))[j.Group = 2] = "Group", j[j.WorkingGroup = 2] = "WorkingGroup", exports.GroupJoinSource = void 0, (B = exports.GroupJoinSource || (exports.GroupJoinSource = {}))[B.Invitation = 2] = "Invitation", B[B.Search = 3] = "Search", B[B.QrCode = 4] = "QrCode", exports.GroupMemberRole = void 0, (V = exports.GroupMemberRole || (exports.GroupMemberRole = {}))[V.Nomal = 20] = "Nomal", V[V.Admin = 60] = "Admin", V[V.Owner = 100] = "Owner", exports.GroupVerificationType = void 0, (_ = exports.GroupVerificationType || (exports.GroupVerificationType = {}))[_.ApplyNeedInviteNot = 0] = "ApplyNeedInviteNot", _[_.AllNeed = 1] = "AllNeed", _[_.AllNot = 2] = "AllNot", exports.MessageStatus = void 0, (H = exports.MessageStatus || (exports.MessageStatus = {}))[H.Sending = 1] = "Sending", H[H.Succeed = 2] = "Succeed", H[H.Failed = 3] = "Failed", exports.Platform = void 0, (J = exports.Platform || (exports.Platform = {}))[J.iOS = 1] = "iOS", J[J.Android = 2] = "Android", J[J.Windows = 3] = "Windows", J[J.MacOSX = 4] = "MacOSX", J[J.Web = 5] = "Web", J[J.Linux = 7] = "Linux", J[J.AndroidPad = 8] = "AndroidPad", J[J.iPad = 9] = "iPad", exports.LogLevel = void 0, (W = exports.LogLevel || (exports.LogLevel = {}))[W.Silent = 5] = "Silent", W[W.Error = 4] = "Error", W[W.Warn = 3] = "Warn", W[W.Info = 2] = "Info", W[W.Debug = 1] = "Debug", W[W.Trace = 0] = "Trace", exports.ApplicationHandleResult = void 0, (K = exports.ApplicationHandleResult || (exports.ApplicationHandleResult = {}))[K.Unprocessed = 0] = "Unprocessed", K[K.Agree = 1] = "Agree", K[K.Reject = -1] = "Reject", exports.MessageType = void 0, (Q = exports.MessageType || (exports.MessageType = {}))[Q.TextMessage = 101] = "TextMessage", Q[Q.PictureMessage = 102] = "PictureMessage", Q[Q.VoiceMessage = 103] = "VoiceMessage", Q[Q.VideoMessage = 104] = "VideoMessage", Q[Q.FileMessage = 105] = "FileMessage", Q[Q.AtTextMessage = 106] = "AtTextMessage", Q[Q.MergeMessage = 107] = "MergeMessage", Q[Q.CardMessage = 108] = "CardMessage", Q[Q.LocationMessage = 109] = "LocationMessage", Q[Q.CustomMessage = 110] = "CustomMessage", Q[Q.TypingMessage = 113] = "TypingMessage", Q[Q.QuoteMessage = 114] = "QuoteMessage", Q[Q.FaceMessage = 115] = "FaceMessage", Q[Q.FriendAdded = 1201] = "FriendAdded", Q[Q.OANotification = 1400] = "OANotification", Q[Q.GroupCreated = 1501] = "GroupCreated", Q[Q.MemberQuit = 1504] = "MemberQuit", Q[Q.GroupOwnerTransferred = 1507] = "GroupOwnerTransferred", Q[Q.MemberKicked = 1508] = "MemberKicked", Q[Q.MemberInvited = 1509] = "MemberInvited", Q[Q.MemberEnter = 1510] = "MemberEnter", Q[Q.GroupDismissed = 1511] = "GroupDismissed", Q[Q.GroupMemberMuted = 1512] = "GroupMemberMuted", Q[Q.GroupMemberCancelMuted = 1513] = "GroupMemberCancelMuted", Q[Q.GroupMuted = 1514] = "GroupMuted", Q[Q.GroupCancelMuted = 1515] = "GroupCancelMuted", Q[Q.GroupAnnouncementUpdated = 1519] = "GroupAnnouncementUpdated", Q[Q.GroupNameUpdated = 1520] = "GroupNameUpdated", Q[Q.BurnMessageChange = 1701] = "BurnMessageChange", Q[Q.RevokeMessage = 2101] = "RevokeMessage", exports.SessionType = void 0, (z = exports.SessionType || (exports.SessionType = {}))[z.Single = 1] = "Single", z[z.Group = 3] = "Group", z[z.Notification = 4] = "Notification", exports.GroupAtType = void 0, (Y = exports.GroupAtType || (exports.GroupAtType = {}))[Y.AtNormal = 0] = "AtNormal", Y[Y.AtMe = 1] = "AtMe", Y[Y.AtAll = 2] = "AtAll", Y[Y.AtAllAtMe = 3] = "AtAllAtMe", Y[Y.AtGroupNotice = 4] = "AtGroupNotice", exports.GroupMemberFilter = void 0, (X = exports.GroupMemberFilter || (exports.GroupMemberFilter = {}))[X.All = 0] = "All", X[X.Owner = 1] = "Owner", X[X.Admin = 2] = "Admin", X[X.Nomal = 3] = "Nomal", X[X.AdminAndNomal = 4] = "AdminAndNomal", X[X.AdminAndOwner = 5] = "AdminAndOwner", exports.Relationship = void 0, ($ = exports.Relationship || (exports.Relationship = {}))[$.isBlack = 0] = "isBlack", $[$.isFriend = 1] = "isFriend", exports.LoginStatus = void 0, (Z = exports.LoginStatus || (exports.LoginStatus = {}))[Z.Logout = 1] = "Logout", Z[Z.Logging = 2] = "Logging", Z[Z.Logged = 3] = "Logged", exports.OnlineState = void 0, (ee = exports.OnlineState || (exports.OnlineState = {}))[ee.Online = 1] = "Online", ee[ee.Offline = 0] = "Offline", exports.ViewType = void 0, (te = exports.ViewType || (exports.ViewType = {}))[te.ViewHistory = 0] = "ViewHistory", te[te.ViewSearch = 1] = "ViewSearch";
      var oe = function() {
        return (36 * Math.random()).toString(36).slice(2) + (/* @__PURE__ */ new Date()).getTime().toString();
      };
      var ie = function(e2) {
        var t2 = (/* @__PURE__ */ new Date()).getTime().toString(), r2 = Math.floor(Math.random() * (/* @__PURE__ */ new Date()).getTime());
        return a.default.hash(t2 + e2 + r2);
      };
      var se = function(e2) {
        if (e2.sessionType === exports.SessionType.Single) {
          var t2 = [e2.sendID, e2.recvID].sort();
          return "si_" + t2[0] + "_" + t2[1];
        }
        return e2.sessionType === exports.SessionType.Group ? "sg_" + e2.groupID : e2.sessionType === exports.SessionType.Notification ? "sn_" + e2.sendID + "_" + e2.recvID : "";
      };
      var ae = function(e2) {
        if (e2.sessionType === exports.SessionType.Single) {
          var t2 = [e2.sourceID, e2.userID].sort();
          return "si_" + t2[0] + "_" + t2[1];
        }
        return e2.sessionType === exports.SessionType.Group ? "sg_" + e2.sourceID : e2.sessionType === exports.SessionType.Notification ? "sn_" + e2.sourceID + "_" + e2.userID : "";
      };
      var ue = function(e2, t2) {
        return !(t2 in e2 && !e2[t2]);
      };
      var ce = ((re = {})[exports.ReqIdentifier.GetNewestSeq] = n.PbCoder.GetMaxSeqResp.decode, re[exports.ReqIdentifier.PullMsgByRange] = n.PbCoder.PullMessageBySeqsResp.decode, re[exports.ReqIdentifier.SendMsg] = n.PbCoder.UserSendMsgResp.decode, re[exports.ReqIdentifier.PullMsgBySeqList] = n.PbCoder.GetSeqMessageResp.decode, re[exports.ReqIdentifier.PushMsg] = n.PbCoder.PushMessages.decode, re[exports.ReqIdentifier.SetBackgroundStatus] = n.PbCoder.SetAppBackgroundStatusResp.decode, re[exports.ReqIdentifier.WsSubUserOnlineStatus] = n.PbCoder.SubUserOnlineStatusTips.decode, re[exports.ReqIdentifier.GetConvMaxReadSeq] = n.PbCoder.GetConversationsHasReadAndMaxSeqResp.decode, re[C.GetActiveConversations] = n.PbCoder.GetActiveConversationsResp.decode, re[C.GetDesignatedConversation] = n.PbCoder.GetConversationsResp.decode, re);
      var de = function(e2, t2) {
        if (!e2) return null;
        var n2 = ce[t2];
        if (!n2) return s.default.warn("base64ToJson: no decoder for identifier", { identifier: t2 }), null;
        var o2 = r.decode(e2);
        return n2(new Uint8Array(o2));
      };
      var pe = function(e2, t2, r2) {
        var n2 = (/* @__PURE__ */ new Date()).getTime(), o2 = e2.userTrigger.cache.getSelfUserInfo();
        return { clientMsgID: ie(e2.userID), createTime: n2, sendTime: n2, sessionType: 0, sendID: e2.userID, msgFrom: t2, contentType: r2, senderPlatformID: e2.platform, senderNickname: null == o2 ? void 0 : o2.nickname, senderFaceUrl: null == o2 ? void 0 : o2.faceURL, seq: 0, isRead: false, status: exports.MessageStatus.Sending };
      };
      var ge = function(e2) {
        return e2.sort(function(e3, t2) {
          return e3.isPinned === t2.isPinned ? e3.latestMsgSendTime > t2.latestMsgSendTime ? -1 : e3.latestMsgSendTime < t2.latestMsgSendTime ? 1 : 0 : e3.isPinned && !t2.isPinned ? -1 : 1;
        });
      };
      var le = /* @__PURE__ */ (function(e2) {
        function t2(t3, r2) {
          var n2;
          return (n2 = e2.call(this, r2) || this).errCode = void 0, n2.name = n2.constructor.name, n2.errCode = t3, Error.captureStackTrace && Error.captureStackTrace(n2, n2.constructor), n2;
        }
        return v(t2, e2), t2;
      })(/* @__PURE__ */ M(Error));
      var fe = function(e2, t2, r2, n2) {
        var o2 = { event: t2, operationID: r2, data: null, errMsg: "", errCode: 0 };
        return e2 === exports.LoginStatus.Logout ? Promise.reject(l({}, o2, { errCode: exports.ErrorCode.ResourceLoadNotCompleteError, errMsg: "Resource load not complete" })) : n2().then(function(e3) {
          return void 0 === e3 && (e3 = null), l({}, o2, { data: e3 });
        }).catch(function(e3) {
          return l({}, o2, { errCode: e3.errCode || exports.ErrorCode.SdkInternalError, errMsg: e3.message || "Internal Error" });
        });
      };
      function ve(e2) {
        return e2.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      }
      var he = "UTF-8";
      var me = "ASCII";
      var Ie = he;
      var Me = 65533;
      var ye = function(e2, t2) {
        if (e2 < 128) t2.push(e2);
        else for (var r2 = [127, 2047, 65535, 2097151], n2 = 0; ; ) {
          if (++n2 === r2.length) return console.error("UTF-8 Write - attempted to encode illegally high code point - " + e2), void ye(Me, t2);
          if (e2 <= r2[n2]) {
            n2 += 1;
            var o2 = 0, i2 = void 0;
            for (i2 = 0; i2 < n2; i2++) o2 <<= 1, o2 |= 1;
            for (o2 <<= 8 - n2, t2.push(o2 |= e2 >> 6 * (n2 - 1)), i2 = 1; i2 < n2; i2++) o2 = 128, t2.push(o2 |= e2 >> 6 * (n2 - (i2 + 1)) & 191);
            return;
          }
        }
      };
      var De = function(e2, t2, r2, n2) {
        var o2 = t2.getUint8(r2);
        if (e2.bytesRead = 1, e2.charVal = 0, 128 & o2) {
          for (var i2 = 0, s2 = o2; 128 & s2; ) i2++, s2 <<= 1;
          if (1 === i2) return console.error("UTF-8 read - found continuation byte at beginning of character"), void (e2.charVal = Me);
          if (i2 > n2) return console.error("UTF-8 read - attempted to read " + i2 + " byte character, " + (n2 - i2) + " bytes past end of buffer"), void (e2.charVal = Me);
          e2.charVal = o2 & 255 >> i2 + 1;
          for (var a2 = 1; a2 < i2; a2++) {
            if (128 != (192 & (s2 = t2.getUint8(r2 + a2)))) return console.error("UTF-8 read - attempted to read " + i2 + " byte character, found non-continuation at byte " + a2), e2.charVal = Me, void (e2.bytesRead = 1);
            if (e2.charVal <<= 6, e2.charVal |= 63 & s2, !(1 !== a2 || e2.charVal >> 8 - (i2 + 1) - 1)) return console.error("UTF-8 read - found overlong encoding"), e2.charVal = Me, void (e2.bytesRead = 1);
            e2.bytesRead++;
          }
          if (e2.charVal > 1114111) return console.error("UTF-8 read - found illegally high code point " + e2.charVal), e2.charVal = Me, void (e2.bytesRead = 1);
        } else e2.charVal = o2;
      };
      var Ce = function(e2) {
        for (var t2 = [], r2 = 0; r2 < e2.length; r2++) ye(e2.charCodeAt(r2), t2);
        return t2;
      };
      var Se = function(e2) {
        for (var t2 = [], r2 = 0; r2 < e2.length; r2++) {
          var n2 = e2.charCodeAt(r2);
          n2 > 255 && (n2 = "?".charCodeAt(0)), t2.push(n2);
        }
        return t2;
      };
      var Te = function(e2, t2, r2, n2) {
        var o2 = void 0 === r2, i2 = t2 || 0;
        if (!o2 && i2 + r2 > e2.byteLength) throw new Error("Attempted to read " + (i2 + r2 - e2.byteLength) + " bytes past end of buffer");
        for (var s2 = [], a2 = {}; i2 < e2.byteLength && (o2 || r2 > i2 - t2) && (De(a2, e2, i2, o2 ? e2.byteLength - (i2 + t2) : r2 - (i2 - t2)), i2 += a2.bytesRead, !o2 || a2.charVal !== n2); ) s2.push(String.fromCharCode(a2.charVal));
        return { str: s2.join(""), byteLength: i2 - t2 };
      };
      var xe = function(e2, t2, r2, n2) {
        var o2 = [], i2 = 0;
        t2 = t2 || 0;
        var s2 = false;
        void 0 === r2 && (s2 = true, r2 = e2.byteLength - e2.byteOffset);
        for (var a2 = 0; a2 < r2; a2++) {
          var u2 = e2.getUint8(a2 + t2);
          if (i2++, s2 && u2 === n2) break;
          o2.push(String.fromCharCode(u2));
        }
        return { str: o2.join(""), byteLength: i2 };
      };
      var be = /* @__PURE__ */ p("readString");
      var Ae = /* @__PURE__ */ p("writeString");
      var Re = /* @__PURE__ */ p("checkEncoding");
      function Pe(e2) {
        if (void 0 === e2 && (e2 = Ie), !c(this, Ae)[Ae].has(e2)) throw new Error("Unknown string encoding '" + e2 + "'");
        return e2;
      }
      var Ge;
      var Ne = new (/* @__PURE__ */ (function() {
        function e2() {
          Object.defineProperty(this, Re, { value: Pe }), Object.defineProperty(this, be, { writable: true, value: /* @__PURE__ */ new Map([[me, xe], [he, Te]]) }), Object.defineProperty(this, Ae, { writable: true, value: /* @__PURE__ */ new Map([[me, Se], [he, Ce]]) });
        }
        var t2 = e2.prototype;
        return t2.addStringCodec = function(e3, t3, r2) {
          c(this, be)[be].set(e3, t3), c(this, Ae)[Ae].set(e3, r2);
        }, t2.stringByteLength = function(e3, t3) {
          return t3 = c(this, Re)[Re](t3), c(this, Ae)[Ae].get(t3)(e3).length;
        }, t2.getString = function(e3, t3, r2, n2) {
          return this.getStringData(e3, t3, r2, n2).str;
        }, t2.getStringData = function(e3, t3, r2, n2) {
          return n2 = c(this, Re)[Re](n2), r2 || (r2 = e3.byteLength - t3), c(this, be)[be].get(n2)(e3, t3, r2);
        }, t2.getStringNT = function(e3, t3, r2, n2) {
          return void 0 === n2 && (n2 = 0), this.getStringDataNT(e3, t3, r2, n2).str;
        }, t2.getStringDataNT = function(e3, t3, r2, n2) {
          return void 0 === n2 && (n2 = 0), r2 = c(this, Re)[Re](r2), c(this, be)[be].get(r2)(e3, t3, void 0, n2);
        }, t2.setString = function(e3, t3, r2, n2) {
          n2 = c(this, Re)[Re](n2);
          var o2, i2 = c(this, Ae)[Ae].get(n2)(r2);
          for (o2 = 0; o2 < i2.length && t3 + o2 < e3.byteLength; o2++) e3.setUint8(t3 + o2, i2[o2]);
          return o2;
        }, t2.setStringNT = function(e3, t3, r2, n2) {
          var o2 = this.setString(e3, t3, r2, n2);
          return t3 + o2 >= e3.byteLength && (o2 -= 1), e3.setUint8(t3 + o2, 0), o2 + 1;
        }, e2;
      })())();
      var qe = function(e2) {
        return new TextDecoder().decode(e2);
      };
      var Ee = function(e2) {
        return new TextEncoder().encode(e2);
      };
      !(function(e2) {
        e2[e2.CONNECTING = 0] = "CONNECTING", e2[e2.OPEN = 1] = "OPEN", e2[e2.CLOSING = 2] = "CLOSING", e2[e2.CLOSED = 3] = "CLOSED";
      })(Ge || (Ge = {}));
      var we;
      var Ue = /* @__PURE__ */ (function() {
        function e2(e3, t2, r2, n2, o2, i2, s2, a2, u2, c2) {
          var d2 = this, p2 = this;
          void 0 === a2 && (a2 = 5e3), void 0 === u2 && (u2 = Infinity), this.url = void 0, this.onMessage = void 0, this.onClose = void 0, this.onReconnecting = void 0, this.onReconnectFailed = void 0, this.onReconnectSuccess = void 0, this.reconnectInterval = void 0, this.maxReconnectAttempts = void 0, this.ws = void 0, this.connectParams = void 0, this.reconnectAttempts = void 0, this.shouldReconnect = void 0, this.isProcessingMessage = false, this.consecutiveHeartbeatFailures = 0, this.connectTimeoutId = null, this.platformNamespace = void 0, this.envListenersInstalled = false, this.heartbeatConfig = { interval: 1e4, timeout: 5e3, maxFailures: 3 }, this.heartbeatWorker = null, this.legacyTimer = null, this.heartbeatTimeoutId = null, this.workerUrl = null, this.lastPongAt = 0, this.forceImmediateReconnect = false, this.checkPlatform = function() {
            if ("undefined" != typeof WebSocket) try {
              if ("undefined" != typeof window && window.WebSocket) return "web";
              if ("undefined" != typeof global && global.WebSocket) return "web";
            } catch (e4) {
            }
            return "undefined" != typeof my && "function" == typeof my.connectSocket ? "my" : "undefined" != typeof uni && "function" == typeof uni.connectSocket ? "uni" : "undefined" != typeof wx && "function" == typeof wx.connectSocket ? "wx" : "unknow";
          }, this.urlFormat = function() {
            var e4 = "?v=" + (function(e5) {
              var t3 = (function(e6) {
                if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(e6);
                for (var t4 = unescape(encodeURIComponent(e6)), r4 = new Uint8Array(t4.length), n4 = 0; n4 < t4.length; n4++) r4[n4] = t4.charCodeAt(n4);
                return r4;
              })(e5);
              if ("undefined" != typeof wx && "function" == typeof wx.arrayBufferToBase64) return ve(wx.arrayBufferToBase64(t3.buffer));
              if ("undefined" != typeof Buffer && "function" == typeof Buffer.from) return ve(Buffer.from(t3).toString("base64"));
              if ("function" == typeof btoa) {
                for (var r3 = "", n3 = 0; n3 < t3.length; n3 += 32768) r3 += String.fromCharCode.apply(String, t3.subarray(n3, n3 + 32768));
                return ve(btoa(r3));
              }
              throw new Error("No base64 encoder available in this environment");
            })(JSON.stringify(p2.connectParams));
            return p2.url + e4;
          }, this.startHeartbeat = function() {
            if (p2.heartbeatWorker && p2.stopHeartbeat(), p2.consecutiveHeartbeatFailures = 0, "undefined" != typeof Worker) try {
              var e4 = new Blob(["\n        let timerId = null;\n        let heartbeatInterval;\n\n        self.onmessage = (e) => {\n          if (e.data.type === 'start') {\n            heartbeatInterval = e.data.interval;\n            if (timerId) return;\n            \n            timerId = self.setInterval(() => {\n              self.postMessage({ type: 'ping' });\n            }, heartbeatInterval);\n          } else if (e.data.type === 'stop') {\n            if (timerId) {\n              self.clearInterval(timerId);\n              timerId = null;\n            }\n          }\n        };\n      "], { type: "application/javascript" });
              p2.workerUrl = URL.createObjectURL(e4), p2.heartbeatWorker = new Worker(p2.workerUrl), p2.heartbeatWorker.onmessage = function(e5) {
                "ping" === e5.data.type && p2.sendPing();
              }, p2.heartbeatWorker.postMessage({ type: "start", interval: p2.heartbeatConfig.interval });
            } catch (e5) {
              p2.heartbeatWorker = null, p2.workerUrl && (URL.revokeObjectURL(p2.workerUrl), p2.workerUrl = null), p2.legacyTimer = setInterval(function() {
                p2.sendPing();
              }, p2.heartbeatConfig.interval);
            }
            else p2.legacyTimer = setInterval(function() {
              p2.sendPing();
            }, p2.heartbeatConfig.interval);
          }, this.connect = function(e4) {
            return void 0 === e4 && (e4 = 1e4), "unknow" === p2.platformNamespace ? Promise.reject(new Error("WebSocket is not supported")) : new Promise(function(t3, r3) {
              if (p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), p2.connectTimeoutId = setTimeout(function() {
                p2.ws && (p2.ws.close(), p2.onClose()), r3(new Error("Connection timeout after " + e4 + "ms"));
              }, e4), p2.ws && p2.ws.readyState !== Ge.CLOSED) p2.ws.readyState === p2.ws.OPEN ? (p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), t3()) : (p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), r3(new Error("WebSocket is in an unknown state")));
              else {
                var n3 = function() {
                  p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), p2.reconnectAttempts && p2.onReconnectSuccess(), p2.reconnectAttempts = 0, p2.consecutiveHeartbeatFailures = 0, p2.lastPongAt = Date.now(), p2.startHeartbeat(), t3();
                }, o3 = function(e5) {
                  p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), r3(e5);
                };
                if ("web" === p2.platformNamespace) p2.ws = new WebSocket(p2.urlFormat()), p2.ws.onopen = n3, p2.ws.onerror = o3;
                else {
                  var i3 = { url: p2.urlFormat(), complete: function() {
                  } };
                  "my" === p2.platformNamespace && (i3.multiple = true), "uni" === p2.platformNamespace && (p2.ws = uni.connectSocket(i3)), "wx" === p2.platformNamespace && (p2.ws = wx.connectSocket(i3)), "my" === p2.platformNamespace && (p2.ws = my.connectSocket(i3)), p2.ws.onOpen(n3), p2.ws.onError(o3);
                }
                p2.setupEventListeners(), p2.installEnvListeners();
              }
            });
          }, this.setupEventListeners = function() {
            if (p2.ws) {
              var e4 = function(e5) {
                return p2.onBinaryMessage(e5.data);
              }, t3 = function(e5) {
                if (p2.shouldReconnect && p2.reconnectAttempts < p2.maxReconnectAttempts) {
                  if (p2.isProcessingMessage) return void setTimeout(function() {
                    return t3();
                  }, 100);
                  var r3 = function() {
                    p2.onReconnecting(), p2.connectParams.operationID = oe(), p2.connect().catch(function() {
                      p2.onReconnectFailed();
                    }), p2.reconnectAttempts++;
                  };
                  if (p2.forceImmediateReconnect) p2.forceImmediateReconnect = false, r3();
                  else {
                    var n3 = Math.min(p2.reconnectInterval * Math.pow(1.5, p2.reconnectAttempts), 6e4), o3 = 0.25 * n3 * (2 * Math.random() - 1), i3 = Math.max(n3 + o3, 1e3);
                    setTimeout(function() {
                      r3();
                    }, i3);
                  }
                }
                p2.stopHeartbeat(), p2.heartbeatTimeoutId && (clearTimeout(p2.heartbeatTimeoutId), p2.heartbeatTimeoutId = null), p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null);
              };
              "web" === p2.platformNamespace ? (p2.ws.onmessage = e4, p2.ws.onclose = t3) : (p2.ws.onMessage(e4), p2.ws.onClose(t3));
            }
          }, this.onBinaryMessage = function(e4) {
            try {
              return "string" != typeof e4 && "my" === d2.platformNamespace && (e4 = e4.data), "string" == typeof e4 && "pong" === JSON.parse(e4).type ? (d2.heartbeatTimeoutId && (clearTimeout(d2.heartbeatTimeoutId), d2.heartbeatTimeoutId = null), d2.consecutiveHeartbeatFailures = 0, d2.lastPongAt = Date.now(), Promise.resolve()) : (d2.isProcessingMessage = true, Promise.resolve(d2.onMessage(e4, d2.connectParams.operationID)).then(function() {
                d2.isProcessingMessage = false;
              }));
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.sendPing = function() {
            var e4;
            if ((null == (e4 = p2.ws) ? void 0 : e4.readyState) === Ge.OPEN) {
              if (p2.consecutiveHeartbeatFailures >= p2.heartbeatConfig.maxFailures) return console.warn("Heartbeat failed " + p2.consecutiveHeartbeatFailures + " times, closing connection"), p2.ws.close(), p2.onClose(), void p2.stopHeartbeat();
              p2.heartbeatTimeoutId && clearTimeout(p2.heartbeatTimeoutId), p2.heartbeatTimeoutId = setTimeout(function() {
                var e5;
                p2.consecutiveHeartbeatFailures++, console.warn("Heartbeat timeout, consecutive failures: " + p2.consecutiveHeartbeatFailures), p2.consecutiveHeartbeatFailures >= p2.heartbeatConfig.maxFailures && (null == (e5 = p2.ws) || e5.close(), p2.onClose(), p2.stopHeartbeat());
              }, p2.heartbeatConfig.timeout);
              var t3 = JSON.stringify({ type: "ping" });
              p2.ws.send("web" === p2.platformNamespace ? t3 : { data: t3 });
            } else p2.heartbeatTimeoutId && (clearTimeout(p2.heartbeatTimeoutId), p2.heartbeatTimeoutId = null);
          }, this.forceHealthCheck = function(e4) {
            void 0 === e4 && (e4 = false), p2.ws && p2.ws.readyState === Ge.OPEN && (e4 && (p2.consecutiveHeartbeatFailures = Math.max(p2.heartbeatConfig.maxFailures - 1, 0)), p2.sendPing());
          }, this.handleVisibilityChange = function() {
            try {
              "visible" === ("undefined" != typeof document ? document.visibilityState : "visible") && p2.forceHealthCheck(true);
            } catch (e4) {
            }
          }, this.handleOnline = function() {
            if (!p2.ws || p2.ws.readyState !== Ge.OPEN) return p2.reconnectAttempts = 0, p2.onReconnecting(), p2.connectParams.operationID = oe(), void p2.connect().catch(function() {
              p2.onReconnectFailed();
            });
            var e4 = Date.now();
            p2.lastPongAt && e4 - p2.lastPongAt > p2.heartbeatConfig.interval + p2.heartbeatConfig.timeout * p2.heartbeatConfig.maxFailures && p2.forceHealthCheck(true);
          }, this.handleOffline = function() {
            p2.stopHeartbeat();
          }, this.installEnvListeners = function() {
            if (!p2.envListenersInstalled && "web" === p2.platformNamespace) try {
              "undefined" != typeof document && document.addEventListener && document.addEventListener("visibilitychange", p2.handleVisibilityChange), "undefined" != typeof window && window.addEventListener && (window.addEventListener("online", p2.handleOnline), window.addEventListener("offline", p2.handleOffline), window.addEventListener("pageshow", p2.handleVisibilityChange), window.addEventListener("focus", p2.handleVisibilityChange)), p2.envListenersInstalled = true;
            } catch (e4) {
            }
          }, this.removeEnvListeners = function() {
            if (p2.envListenersInstalled && "web" === p2.platformNamespace) {
              try {
                "undefined" != typeof document && document.removeEventListener && document.removeEventListener("visibilitychange", p2.handleVisibilityChange), "undefined" != typeof window && window.removeEventListener && (window.removeEventListener("online", p2.handleOnline), window.removeEventListener("offline", p2.handleOffline), window.removeEventListener("pageshow", p2.handleVisibilityChange), window.removeEventListener("focus", p2.handleVisibilityChange));
              } catch (e4) {
              }
              p2.envListenersInstalled = false;
            }
          }, this.sendMessage = function(e4) {
            var t3, r3 = Ee(JSON.stringify(e4));
            (null == (t3 = p2.ws) ? void 0 : t3.readyState) === Ge.OPEN ? p2.ws.send("web" === p2.platformNamespace ? r3 : { data: Uint8Array.from(r3).buffer }) : console.error("WebSocket is not open. Message not sent.");
          }, this.close = function() {
            var e4;
            p2.shouldReconnect = false, p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), p2.heartbeatTimeoutId && (clearTimeout(p2.heartbeatTimeoutId), p2.heartbeatTimeoutId = null), (null == (e4 = p2.ws) ? void 0 : e4.readyState) === Ge.OPEN && (p2.ws.close(), p2.onClose()), p2.stopHeartbeat(), p2.removeEnvListeners();
          }, this.forceReconnect = function(e4) {
            if (void 0 === e4 && (e4 = true), p2.shouldReconnect = true, p2.reconnectAttempts = 0, p2.consecutiveHeartbeatFailures = 0, e4 && (p2.forceImmediateReconnect = true), !p2.ws || p2.ws.readyState === Ge.CLOSED) return p2.onReconnecting(), p2.connectParams.operationID = oe(), void p2.connect().catch(function() {
              p2.onReconnectFailed();
            });
            p2.stopHeartbeat();
            try {
              p2.ws.close();
            } catch (e5) {
              p2.onReconnecting(), p2.connectParams.operationID = oe(), p2.connect().catch(function() {
                p2.onReconnectFailed();
              });
            }
          }, this.reset = function() {
            p2.shouldReconnect = true, p2.reconnectAttempts = 0, p2.consecutiveHeartbeatFailures = 0, p2.connectTimeoutId && (clearTimeout(p2.connectTimeoutId), p2.connectTimeoutId = null), p2.heartbeatTimeoutId && (clearTimeout(p2.heartbeatTimeoutId), p2.heartbeatTimeoutId = null), p2.stopHeartbeat(), p2.removeEnvListeners();
          }, this.url = e3, this.onMessage = r2, this.onClose = n2, this.onReconnecting = o2, this.onReconnectFailed = i2, this.onReconnectSuccess = s2, this.reconnectInterval = a2, this.maxReconnectAttempts = u2, this.connectParams = t2, this.reconnectInterval = a2, this.maxReconnectAttempts = u2, this.reconnectAttempts = 0, this.shouldReconnect = true, this.platformNamespace = this.checkPlatform(), c2 && (this.heartbeatConfig = l({}, this.heartbeatConfig, c2));
        }
        return e2.prototype.stopHeartbeat = function() {
          this.heartbeatTimeoutId && (clearTimeout(this.heartbeatTimeoutId), this.heartbeatTimeoutId = null), this.heartbeatWorker && (this.heartbeatWorker.postMessage({ type: "stop" }), this.heartbeatWorker.terminate(), this.workerUrl && (URL.revokeObjectURL(this.workerUrl), this.workerUrl = null), this.heartbeatWorker = null), this.legacyTimer && (clearInterval(this.legacyTimer), this.legacyTimer = null);
        }, e2;
      })();
      var Oe = /* @__PURE__ */ (function() {
        function e2() {
          this.events = void 0, this.events = {};
        }
        var t2 = e2.prototype;
        return t2.emit = function(e3, t3) {
          return this.events[e3] && this.events[e3].forEach(function(r2) {
            try {
              r2(t3);
            } catch (t4) {
              var n2;
              s.default.error("[Emitter.emit] listener threw", { event: e3, err: null != (n2 = null == t4 ? void 0 : t4.message) ? n2 : String(t4) });
            }
          }), this;
        }, t2.on = function(e3, t3) {
          return this.events[e3] ? this.events[e3].push(t3) : this.events[e3] = [t3], this;
        }, t2.off = function(e3, t3) {
          if (e3 && "function" == typeof t3 && this.events[e3]) {
            var r2 = this.events[e3];
            if (!r2 || 0 === r2.length) return;
            var n2 = r2.findIndex(function(e4) {
              return e4 === t3;
            });
            -1 !== n2 && r2.splice(n2, 1);
          }
          return this;
        }, e2;
      })();
      var Fe = ["friendUser"];
      var ke = ["blackUserInfo"];
      var Le = function(e2) {
        var t2, r2, n2, o2, i2, s2, a2, u2, c2, d2, p2, g2, l2, f2;
        return { createTime: null == (t2 = e2.groupInfo) ? void 0 : t2.createTime, creatorUserID: null == (r2 = e2.groupInfo) ? void 0 : r2.creatorUserID, ex: e2.ex, groupFaceURL: null == (n2 = e2.groupInfo) ? void 0 : n2.faceURL, groupID: null == (o2 = e2.groupInfo) ? void 0 : o2.groupID, groupName: null == (i2 = e2.groupInfo) ? void 0 : i2.groupName, groupType: null == (s2 = e2.groupInfo) ? void 0 : s2.groupType, handleResult: e2.handleResult, handleUserID: e2.handleUserID, handledMsg: e2.handleMsg, handledTime: e2.handleTime, introduction: null == (a2 = e2.groupInfo) ? void 0 : a2.introduction, memberCount: null == (u2 = e2.groupInfo) ? void 0 : u2.memberCount, nickname: null == (c2 = e2.userInfo) ? void 0 : c2.nickname, notification: null == (d2 = e2.groupInfo) ? void 0 : d2.notification, ownerUserID: null == (p2 = e2.groupInfo) ? void 0 : p2.ownerUserID, reqMsg: e2.reqMsg, reqTime: e2.reqTime, joinSource: e2.joinSource, status: null == (g2 = e2.groupInfo) ? void 0 : g2.status, userFaceURL: null == (l2 = e2.userInfo) ? void 0 : l2.faceURL, userID: null == (f2 = e2.userInfo) ? void 0 : f2.userID };
      };
      var je = function(e2) {
        return { clientMsgID: e2.clientMsgID, serverMsgID: e2.serverMsgID, createTime: e2.createTime, sendTime: e2.sendTime, sessionType: e2.sessionType, sendID: e2.sendID, recvID: e2.recvID, msgFrom: e2.msgFrom, contentType: e2.contentType, senderPlatformID: e2.senderPlatformID, senderNickname: e2.senderNickname, senderFaceUrl: e2.senderFaceURL, groupID: e2.groupID, content: e2.content.length ? qe(e2.content) : "", seq: e2.seq, isRead: e2.isRead, status: exports.InternalMessageStatus.MsgStatusSendSuccess, isExternalExtensions: false, offlinePush: e2.offlinePushInfo, attachedInfo: e2.attachedInfo, ex: e2.ex, localEx: "" };
      };
      var Be = function(e2) {
        var t2 = l({}, e2);
        try {
          switch (e2.contentType) {
            case exports.InternalContentType.Text:
              t2.textElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Picture:
              t2.pictureElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Sound:
              t2.soundElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Video:
              t2.videoElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.File:
              t2.fileElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.AtText:
              t2.atTextElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Location:
              t2.locationElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Custom:
            case exports.InternalContentType.CustomMsgNotTriggerConversation:
            case exports.InternalContentType.CustomMsgOnlineOnly:
              t2.customElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Typing:
              t2.typingElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Merger:
              t2.mergeElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Face:
              t2.faceElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Quote:
              t2.quoteElem = JSON.parse(t2.content);
              break;
            case exports.InternalContentType.Card:
              t2.cardElem = JSON.parse(t2.content);
              break;
            default:
              t2.notificationElem = JSON.parse(t2.content);
          }
        } catch (e3) {
          s.default.warn("messageElemFormater messageElem parse failed", t2);
        }
        if (e2.attachedInfo) try {
          t2.attachedInfoElem = JSON.parse(t2.attachedInfo), t2.attachedInfo = "";
        } catch (e3) {
          s.default.warn("messageElemFormater attachedInfoElem failed", t2.attachedInfo);
        }
        return t2.content = "", t2;
      };
      var Ve = function(e2) {
        var t2 = qe(e2), r2 = JSON.parse(t2);
        return JSON.parse(r2.detail);
      };
      var _e = function(e2, t2, r2) {
        var n2 = e2.conversation, o2 = e2.group, i2 = e2.friend, s2 = e2.user, a2 = e2.lastMsg, u2 = e2.maxSeq, c2 = e2.readSeq;
        try {
          var d2, p2, g2, l2, f2 = function() {
            var e3, t3;
            return { conversationID: n2.conversationID, conversationType: n2.conversationType, userID: n2.userID, groupID: n2.groupID, showName: d2, faceURL: v2, recvMsgOpt: n2.recvMsgOpt, unreadCount: u2 - c2, groupAtType: n2.groupAtType, latestMsg: h2, latestMsgSendTime: null != (e3 = null != (t3 = null == a2 ? void 0 : a2.sendTime) ? t3 : r2) ? e3 : 0, draftText: "", draftTextTime: 0, burnDuration: n2.burnDuration, msgDestructTime: n2.msgDestructTime, isPinned: n2.isPinned, isPrivateChat: n2.isPrivateChat, isMsgDestruct: n2.isMsgDestruct, attachedInfo: n2.attachedInfo, ex: n2.ex };
          }, v2 = "", h2 = a2 ? JSON.stringify(Be(je(a2))) : "";
          (null == n2 ? void 0 : n2.conversationType) === exports.SessionType.Group ? (d2 = null != (p2 = null == o2 ? void 0 : o2.groupName) ? p2 : "", v2 = null != (g2 = null == o2 ? void 0 : o2.faceURL) ? g2 : "") : (d2 = (null == i2 ? void 0 : i2.remark) || (null == s2 ? void 0 : s2.nickname) || "", v2 = null != (l2 = null == s2 ? void 0 : s2.faceURL) ? l2 : "");
          var m2 = (function() {
            if ((null == a2 ? void 0 : a2.status) === exports.InternalMessageStatus.MsgStatusHasDeleted) return Promise.resolve(t2({ conversationID: null == n2 ? void 0 : n2.conversationID, seq: a2.seq, operationID: oe() })).then(function(e3) {
              e3 && (h2 = JSON.stringify(Be(e3)));
            });
          })();
          return Promise.resolve(m2 && m2.then ? m2.then(f2) : f2());
        } catch (e3) {
          return Promise.reject(e3);
        }
      };
      var He = function(e2) {
        var t2 = e2.friendUser;
        return l({}, m(e2, Fe), { userID: t2.userID, nickname: t2.nickname, faceURL: t2.faceURL, attachedInfo: "" });
      };
      var Je = function(e2) {
        var t2 = e2.blackUserInfo;
        return l({}, m(e2, ke), { userID: t2.userID, nickname: t2.nickname, faceURL: t2.faceURL });
      };
      var We = /* @__PURE__ */ (function() {
        function e2(e3) {
          var t3 = this;
          this.store = void 0, this.options = void 0, this.expiryListeners = [], this.cleanupTimer = void 0, this.options = e3, this.store = /* @__PURE__ */ new Map(), this.options.cleanupInterval > 0 && (this.cleanupTimer = setInterval(function() {
            t3.deleteExpired();
          }, this.options.cleanupInterval));
        }
        var t2 = e2.prototype;
        return t2.onExpiry = function(e3) {
          this.expiryListeners.push(e3);
        }, t2.triggerExpiry = function(e3, t3) {
          this.expiryListeners.forEach(function(r2) {
            return r2(e3, t3);
          }), this.delete(e3);
        }, t2.set = function(e3, t3) {
          var r2 = this;
          this.delete(e3);
          var n2 = Date.now(), o2 = null;
          this.options.ttl > 0 && (o2 = setTimeout(function() {
            clearTimeout(o2), r2.triggerExpiry(e3, t3);
          }, this.options.ttl)), this.store.set(e3, { value: t3, timer: o2, created: n2 });
        }, t2.get = function(e3) {
          var t3 = this.store.get(e3);
          if (t3 && Date.now() - t3.created < this.options.ttl) return t3.value;
        }, t2.delete = function(e3) {
          var t3 = this.store.get(e3);
          return !!t3 && (t3.timer && clearTimeout(t3.timer), this.store.delete(e3), true);
        }, t2.clear = function() {
          this.store.forEach(function(e3, t3) {
            e3.timer && clearTimeout(e3.timer);
          }), this.store.clear();
        }, t2.deleteExpired = function() {
          var e3 = this, t3 = Date.now();
          this.store.forEach(function(r2, n2) {
            r2.created + e3.options.ttl <= t3 && e3.triggerExpiry(n2, r2.value);
          });
        }, t2.dispose = function() {
          this.cleanupTimer && clearInterval(this.cleanupTimer), this.clear();
        }, e2;
      })();
      var Ke = 15e3;
      !(function(e2) {
        e2.Success = "stateCodeSuccess", e2.End = "stateCodeEnd";
      })(we || (we = {}));
      var Qe = function(e2) {
        var t2 = this, r2 = this, o2 = this;
        this.ctx = void 0, this.send = void 0, this.state = void 0, this.platformIDs = [], this.platformIDSet = /* @__PURE__ */ new Map(), this.reset = function() {
          o2.send.clear(), o2.state.clear();
        }, this.changeInputStates = function(e3) {
          var r3 = e3.conversationID, o3 = e3.focus, i2 = e3.operationID;
          try {
            return Promise.resolve(t2.ctx.messageTrigger.getOneConversationAndTryChange(r3, i2)).then(function(e4) {
              if (!e4) throw new Error("conversation not exist");
              if (o3) {
                if (t2.send.get(r3) === we.Success) return;
                t2.send.set(r3, we.Success);
              } else {
                if (!t2.send.get(r3)) return;
                if (t2.send.get(r3) === we.End) return;
                t2.send.set(r3, we.End);
              }
              var s2 = pe(t2.ctx, exports.MsgFrom.UserMsgType, exports.MessageType.TypingMessage);
              s2.recvID = e4.userID, s2.groupID = e4.groupID, s2.sessionType = e4.conversationType, s2.content = JSON.stringify({ msgTips: o3 ? "yes" : "no" });
              var a2 = {};
              Object.values(exports.MessageOptionsKey).forEach(function(e5) {
                return a2[e5] = false;
              });
              var u2 = n.PbCoder.MsgData.encode(l({}, s2, { content: Ee(s2.content), senderFaceURL: s2.senderFaceUrl, options: a2, offlinePushInfo: void 0, atUserIDList: [], keyVersion: 0, dstUserIDs: [] })).finish();
              return Promise.resolve(t2.ctx.sendReqWaitResp({ data: u2, operationID: i2, reqIdentifier: exports.ReqIdentifier.SendMsg })).then(function() {
              });
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.onNewMessage = function(e3) {
          try {
            var t3 = e3.typingElem;
            if (e3.sendID === r2.ctx.userID) return Promise.resolve();
            if (!r2.platformIDSet.has(e3.senderPlatformID)) return Promise.resolve();
            var n2 = Date.now() + 10, o3 = ae({ sourceID: e3.groupID || e3.sendID, sessionType: e3.sessionType, userID: r2.ctx.userID }), i2 = JSON.stringify({ conversationID: o3, platformID: e3.senderPlatformID, userID: e3.sendID });
            return "yes" === (null == t3 ? void 0 : t3.msgTips) ? (r2.state.get(i2) || setTimeout(function() {
              return r2.triggerChange(o3, e3.sendID);
            }), r2.state.set(i2, n2)) : r2.triggerChange(o3, e3.sendID), Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.triggerChange = function(e3, t3) {
          o2.ctx.triggerEvent({ event: exports.CbEvents.OnConversationUserInputStatusChanged, data: { conversationID: e3, userID: t3, platformIDs: o2.getInputStates(e3, t3) } });
        }, this.getInputStates = function(e3, t3) {
          var r3 = [];
          return o2.platformIDs.forEach(function(n2) {
            var i2 = JSON.stringify({ conversationID: e3, platformID: n2, userID: t3 });
            o2.state.get(i2) && r3.push(n2);
          }), r3;
        }, this.ctx = e2, this.send = new We({ ttl: 1e4, cleanupInterval: Ke }), this.state = new We({ ttl: Ke, cleanupInterval: Ke }), [1, 2, 3, 4, 5, 7, 8, 9].forEach(function(e3) {
          o2.platformIDSet.set(e3), o2.platformIDs.push(e3);
        }), this.platformIDs.sort(function(e3, t3) {
          return e3 - t3;
        }), this.state.onExpiry(function(e3) {
          var t3 = JSON.parse(e3);
          o2.triggerChange(t3.conversationID, t3.userID);
        });
      };
      var ze = function(e2) {
        var t2 = this, r2 = this, o2 = this, i2 = this;
        this.instance = void 0, this.totalUnreadCount = 0, this.cachedNotNotifyConversationIDs = /* @__PURE__ */ new Set(), this.cachedConversations = /* @__PURE__ */ new Map(), this.cachedMessages = /* @__PURE__ */ new Map(), this.cachedFilterMessageSeqs = /* @__PURE__ */ new Map(), this.cachedHasReadAndMaxSeqs = {}, this.clear = function() {
          i2.totalUnreadCount = 0, i2.cachedHasReadAndMaxSeqs = {}, i2.cachedNotNotifyConversationIDs.clear(), i2.cachedMessages.clear(), i2.cachedConversations.clear(), i2.cachedFilterMessageSeqs.clear();
        }, this.getActiveConversationsFromServer = function(e3) {
          try {
            return Promise.resolve(t2.instance.sendHttpRequest({ reqFuncName: C.GetActiveConversations, data: n.PbCoder.GetActiveConversationsReq.encode({ ownerUserID: t2.instance.userID, count: 20 }).finish(), operationID: e3 })).then(function(e4) {
              var r3 = de(e4, C.GetActiveConversations);
              if (r3) {
                console.warn(r3);
                var n2 = r3.conversations;
                t2.totalUnreadCount = r3.unreadCount;
                var o3 = t2.instance.messageTrigger.cache, i3 = o3.setCachedConversations;
                return Promise.resolve(Promise.all(n2.map(function(e5) {
                  var r4, n3;
                  return _e(e5, t2.instance.messageTrigger.getPreviousSeqMessage, null == (r4 = t2.instance.messageTrigger.cache.getCachedMaxReadSeq(null == (n3 = e5.conversation) ? void 0 : n3.conversationID)) ? void 0 : r4.maxSeqTime);
                }))).then(function(e5) {
                  i3.call(o3, e5);
                });
              }
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getTotalUnreadCount = function() {
          return i2.totalUnreadCount;
        }, this.setTotalUnreadCount = function(e3, t3) {
          e3 !== i2.totalUnreadCount && (e3 < 0 && (e3 = 0), i2.totalUnreadCount = e3, i2.instance.triggerEvent({ event: exports.CbEvents.OnTotalUnreadMessageCountChanged, data: e3, operationID: t3 }));
        }, this.decreaseTotalUnreadCount = function(e3, t3) {
          i2.setTotalUnreadCount(i2.totalUnreadCount - e3, t3);
        }, this.getMaxReadSeqs = function(e3, t3) {
          void 0 === t3 && (t3 = []);
          try {
            var o3 = n.PbCoder.GetConversationsHasReadAndMaxSeqReq.encode({ userID: r2.instance.userID, conversationIDs: t3, returnPinned: false }).finish();
            return Promise.resolve(r2.instance.sendReqWaitResp({ operationID: e3, data: o3, reqIdentifier: exports.ReqIdentifier.GetConvMaxReadSeq })).then(function(t4) {
              var n2;
              function o4() {
                r2.cachedHasReadAndMaxSeqs = i3;
              }
              if (t4) {
                var i3 = null != (n2 = t4.seqs) ? n2 : {}, s2 = (function() {
                  if (r2.instance.isReconnected) return Promise.resolve(r2.instance.messageTrigger.syncer.compareSeqsAndBatchSync(i3, e3)).then(function() {
                  });
                })();
                return s2 && s2.then ? s2.then(o4) : o4();
              }
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getSortedConversationIDs = function(e3, t3) {
          return Object.keys(i2.cachedHasReadAndMaxSeqs).sort(function(e4, t4) {
            return i2.cachedHasReadAndMaxSeqs[t4].maxSeqTime - i2.cachedHasReadAndMaxSeqs[e4].maxSeqTime;
          }).slice(e3, e3 + t3);
        }, this.getCachedMaxReadSeq = function(e3) {
          var t3;
          return null == (t3 = i2.cachedHasReadAndMaxSeqs) ? void 0 : t3[e3];
        }, this.addCachedMaxReadSeq = function(e3, t3) {
          i2.cachedHasReadAndMaxSeqs[e3] = t3;
        }, this.updateCachedMaxReadSeq = function(e3, t3) {
          i2.cachedHasReadAndMaxSeqs[e3] ? i2.cachedHasReadAndMaxSeqs[e3] = l({}, i2.cachedHasReadAndMaxSeqs[e3], t3) : s.default.warn("updateCachedMaxReadSeq: conversationID not found", e3, "seqs", t3);
        }, this.removeCachedMaxReadSeq = function(e3) {
          delete i2.cachedHasReadAndMaxSeqs[e3];
        }, this.getNotNotifyConversationIDs = function(e3) {
          try {
            return Promise.resolve(o2.instance.sendHttpRequest({ reqFuncName: C.GetNotNotifyConversationIDs, data: { userID: o2.instance.userID }, operationID: e3 })).then(function(e4) {
              var t3 = e4.conversationIDs;
              o2.cachedNotNotifyConversationIDs = new Set(null != t3 ? t3 : []);
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.isNotNotifyConversation = function(e3) {
          return i2.cachedNotNotifyConversationIDs.has(e3);
        }, this.addNotNotifyConversationID = function(e3) {
          i2.cachedNotNotifyConversationIDs.has(e3) || i2.cachedNotNotifyConversationIDs.add(e3);
        }, this.deleteNotNotifyConversationID = function(e3) {
          i2.cachedNotNotifyConversationIDs.has(e3) && i2.cachedNotNotifyConversationIDs.delete(e3);
        }, this.getCachedConversation = function(e3) {
          return i2.cachedConversations.get(e3);
        }, this.getAllCachedConversations = function() {
          return Array.from(i2.cachedConversations.values());
        }, this.setCachedConversations = function(e3) {
          e3.map(function(e4) {
            i2.cachedConversations.set(e4.conversationID, e4);
          });
        }, this.getCachedMessagesBySeqs = function(e3, t3) {
          var r3 = i2.cachedMessages.get(e3) || [], n2 = [], o3 = [];
          return t3.forEach(function(e4) {
            var t4 = r3.find(function(t5) {
              return t5.seq === e4;
            });
            t4 ? o3.push(t4) : n2.push(e4);
          }), { cachedMessages: o3, unCachedSeqs: n2 };
        }, this.getCachedMessageByClientMsgIDs = function(e3, t3) {
          return (i2.cachedMessages.get(e3) || []).filter(function(e4) {
            return t3.includes(e4.clientMsgID);
          });
        }, this.addMessagesToCache = function(e3, t3) {
          var r3 = i2.cachedMessages.get(e3) || [];
          i2.cachedMessages.set(e3, [].concat(r3, t3));
        }, this.deleteMessageFromCache = function(e3, t3) {
          var r3 = i2.cachedMessages.get(e3) || [];
          i2.cachedMessages.set(e3, r3.filter(function(e4) {
            return e4.seq !== t3;
          })), i2.addFilterSeqsToCache(e3, [t3]);
        }, this.clearCachedConversationMessages = function(e3) {
          i2.cachedMessages.delete(e3);
        }, this.markCachedMessagesAsRead = function(e3, t3) {
          (i2.cachedMessages.get(e3) || []).forEach(function(e4) {
            (!t3 && e4.sendID !== i2.instance.userID || null != t3 && t3.includes(e4.seq)) && (e4.isRead = true);
          });
        }, this.tryUpdateCachedMessages = function(e3, t3) {
          var r3 = i2.cachedMessages.get(e3) || [], n2 = r3.findIndex(function(e4) {
            return e4.clientMsgID === t3.clientMsgID;
          });
          if (-1 !== n2) return Object.assign(r3[n2], t3), r3[n2];
        }, this.tryUpdateQuotedMessage = function(e3, t3) {
          var r3 = i2.cachedMessages.get(e3) || [], n2 = r3.findIndex(function(e4) {
            var r4;
            if (e4.contentType === exports.InternalContentType.Quote) return (null == (r4 = Be(e4).quoteElem) ? void 0 : r4.quoteMessage.clientMsgID) === t3;
          });
          if (-1 !== n2) {
            var o3 = JSON.parse(r3[n2].content);
            o3.quoteMessage.contentType = exports.NotificationType.RevokeNotification, Object.assign(r3[n2], { content: JSON.stringify(o3) });
          }
        }, this.addFilterSeqsToCache = function(e3, t3) {
          var r3 = i2.cachedFilterMessageSeqs.get(e3) || [];
          i2.cachedFilterMessageSeqs.set(e3, [].concat(r3, t3));
        }, this.checkIsFilterSeq = function(e3, t3) {
          var r3;
          return null == (r3 = i2.cachedFilterMessageSeqs.get(e3)) ? void 0 : r3.includes(t3);
        }, this.instance = e2;
      };
      function Ye(e2, t2) {
        try {
          var r2 = e2();
        } catch (e3) {
          return t2(e3);
        }
        return r2 && r2.then ? r2.then(void 0, t2) : r2;
      }
      var Xe = function(e2) {
        var t2 = this, r2 = this, o2 = this, i2 = this, a2 = this;
        this.instance = void 0, this.defaultPullNums = 10, this.SplitPullMsgNum = 100, this.syncedConversationVersion = 0, this.syncedConversationVersionID = "", this.reset = function() {
          a2.syncedConversationVersion = 0, a2.syncedConversationVersionID = "";
        }, this.syncConversationVersion = function(e3) {
          try {
            return Promise.resolve(t2.instance.sendHttpRequest({ operationID: e3, reqFuncName: C.GetConversationVersion, data: { userID: t2.instance.userID, version: t2.syncedConversationVersion, versionID: t2.syncedConversationVersionID } })).then(function(e4) {
              t2.syncedConversationVersionID && t2.compareVersionAndTrigger(e4), t2.syncedConversationVersion = e4.version, t2.syncedConversationVersionID = e4.versionID;
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.compareVersionAndTrigger = function(e3) {
          var t3 = e3.insert, r3 = e3.update;
          (null != t3 ? t3 : []).map(function(e4) {
            return Promise.resolve();
          }), (null != r3 ? r3 : []).map(function(e4) {
            try {
              return Promise.resolve(a2.instance.messageTrigger.getOneConversationAndTryChange(e4.conversationID, "", l({}, e4))).then(function() {
              });
            } catch (e5) {
              return Promise.reject(e5);
            }
          });
        }, this.compareSeqsAndBatchSync = function(e3, t3) {
          try {
            for (var n2 = /* @__PURE__ */ new Map(), o3 = 0, i3 = Object.entries(e3); o3 < i3.length; o3++) {
              var s2, a3 = i3[o3], u2 = a3[0], c2 = a3[1], d2 = null == (s2 = r2.instance.messageTrigger.cache.getCachedMaxReadSeq(u2)) ? void 0 : s2.maxSeq;
              d2 ? c2.maxSeq > d2 && n2.set(u2, [d2 + 1, c2.maxSeq, c2.maxSeqTime]) : n2.set(u2, [0, c2.maxSeq, c2.maxSeqTime]);
            }
            return r2.syncAndTriggerMsgs(n2, t3), Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.isNotification = function(e3) {
          return e3.startsWith("n_");
        }, this.syncAndTriggerMsgs = function(e3, t3) {
          try {
            return s.default.debug("Current sync seqMap", e3, e3.size), Promise.resolve((function() {
              if (e3.size > 0) {
                var r3 = function(r4) {
                  return Ye(function() {
                    return Promise.resolve(o2.pullMsgBySeqRange(n2, t3)).then(function(r5) {
                      return Promise.resolve(o2.instance.messageTrigger.triggerConversation(r5.msgs, t3)).then(function() {
                        return Promise.resolve(o2.instance.messageTrigger.triggerNotification(r5.notificationMsgs, t3)).then(function() {
                          for (var t4, r6 = g(e3); !(t4 = r6()).done; ) {
                            var n3 = t4.value, i4 = n3[1];
                            o2.instance.messageTrigger.cache.updateCachedMaxReadSeq(n3[0], { maxSeq: i4[1], maxSeqTime: i4[2] });
                          }
                        });
                      });
                    });
                  }, function(t4) {
                    throw s.default.error("Sync message from server error", t4, e3), t4;
                  });
                }, n2 = /* @__PURE__ */ new Map(), i3 = 0, a3 = (function(e4, t4) {
                  if ("function" == typeof e4[tt]) {
                    var r4, n3, o3, i4 = function(e5) {
                      try {
                        for (; !(r4 = s2.next()).done; ) if ((e5 = t4(r4.value)) && e5.then) {
                          if (!et(e5)) return void e5.then(i4, o3 || (o3 = $e.bind(null, n3 = new Ze(), 2)));
                          e5 = e5.v;
                        }
                        n3 ? $e(n3, 1, e5) : n3 = e5;
                      } catch (e6) {
                        $e(n3 || (n3 = new Ze()), 2, e6);
                      }
                    }, s2 = e4[tt]();
                    if (i4(), s2.return) {
                      var a4 = function(e5) {
                        try {
                          r4.done || s2.return();
                        } catch (e6) {
                        }
                        return e5;
                      };
                      if (n3 && n3.then) return n3.then(a4, function(e5) {
                        throw a4(e5);
                      });
                      a4();
                    }
                    return n3;
                  }
                  if (!("length" in e4)) throw new TypeError("Object is not iterable");
                  for (var u2 = [], c2 = 0; c2 < e4.length; c2++) u2.push(e4[c2]);
                  return (function(e5, t5) {
                    var r5, n4, o4 = -1;
                    return (function i5(s3) {
                      try {
                        for (; ++o4 < e5.length; ) if ((s3 = t5(o4)) && s3.then) {
                          if (!et(s3)) return void s3.then(i5, n4 || (n4 = $e.bind(null, r5 = new Ze(), 2)));
                          s3 = s3.v;
                        }
                        r5 ? $e(r5, 1, s3) : r5 = s3;
                      } catch (e6) {
                        $e(r5 || (r5 = new Ze()), 2, e6);
                      }
                    })(), r5;
                  })(u2, function(e5) {
                    return t4(u2[e5]);
                  });
                })(e3.entries(), function(e4) {
                  var r4 = e4[0], a4 = e4[1];
                  function u2(e5) {
                    return n2.set(r4, a4), i3 += l2, (function() {
                      if (i3 >= o2.SplitPullMsgNum) return Ye(function() {
                        return Promise.resolve(o2.pullMsgBySeqRange(n2, t3)).then(function(e6) {
                          return Promise.resolve(o2.instance.messageTrigger.triggerConversation(e6.msgs, t3)).then(function() {
                            return Promise.resolve(o2.instance.messageTrigger.triggerNotification(e6.notificationMsgs, t3)).then(function() {
                              for (var e7, t4 = g(n2); !(e7 = t4()).done; ) {
                                var r5 = e7.value, s2 = r5[1];
                                o2.instance.messageTrigger.cache.updateCachedMaxReadSeq(r5[0], { maxSeq: s2[1], maxSeqTime: s2[2] });
                              }
                              n2 = /* @__PURE__ */ new Map(), i3 = 0;
                            });
                          });
                        });
                      }, function(e6) {
                        throw s.default.error("Sync message from server error", e6, n2), e6;
                      });
                    })();
                  }
                  var c2 = a4[0], d2 = a4[1], p2 = a4[2], l2 = d2 - c2 + 1, f2 = (function() {
                    if (l2 / o2.SplitPullMsgNum > 1 && o2.isNotification(r4)) {
                      var e5 = /* @__PURE__ */ new Map(), n3 = Math.floor(l2 / o2.SplitPullMsgNum), i4 = c2, a5 = 0, u3 = 0;
                      return (function(e6, t4, r5) {
                        for (var n4; ; ) {
                          var o3 = e6();
                          if (et(o3) && (o3 = o3.v), !o3) return i5;
                          if (o3.then) {
                            n4 = 0;
                            break;
                          }
                          var i5 = r5();
                          if (i5 && i5.then) {
                            if (!et(i5)) {
                              n4 = 1;
                              break;
                            }
                            i5 = i5.s;
                          }
                          if (t4) {
                            var s2 = t4();
                            if (s2 && s2.then && !et(s2)) {
                              n4 = 2;
                              break;
                            }
                          }
                        }
                        var a6 = new Ze(), u4 = $e.bind(null, a6, 2);
                        return (0 === n4 ? o3.then(d3) : 1 === n4 ? i5.then(c3) : s2.then(p3)).then(void 0, u4), a6;
                        function c3(n5) {
                          i5 = n5;
                          do {
                            if (t4 && (s2 = t4()) && s2.then && !et(s2)) return void s2.then(p3).then(void 0, u4);
                            if (!(o3 = e6()) || et(o3) && !o3.v) return void $e(a6, 1, i5);
                            if (o3.then) return void o3.then(d3).then(void 0, u4);
                            et(i5 = r5()) && (i5 = i5.v);
                          } while (!i5 || !i5.then);
                          i5.then(c3).then(void 0, u4);
                        }
                        function d3(e7) {
                          e7 ? (i5 = r5()) && i5.then ? i5.then(c3).then(void 0, u4) : c3(i5) : $e(a6, 1, i5);
                        }
                        function p3() {
                          (o3 = e6()) ? o3.then ? o3.then(d3).then(void 0, u4) : d3(o3) : $e(a6, 1, i5);
                        }
                      })(function() {
                        return u3 <= n3;
                      }, function() {
                        return u3++;
                      }, function() {
                        return u3 === n3 ? e5.set(r4, [i4, d2, p2]) : ((a5 = i4 + o2.SplitPullMsgNum) > d2 && (a5 = d2, u3 = n3), e5.set(r4, [i4, a5, p2])), Ye(function() {
                          return Promise.resolve(o2.pullMsgBySeqRange(e5, t3)).then(function(r5) {
                            return Promise.resolve(o2.instance.messageTrigger.triggerConversation(r5.msgs, t3)).then(function() {
                              return Promise.resolve(o2.instance.messageTrigger.triggerNotification(r5.notificationMsgs, t3)).then(function() {
                                for (var t4, r6 = g(e5); !(t4 = r6()).done; ) {
                                  var n4 = t4.value, s2 = n4[1];
                                  o2.instance.messageTrigger.cache.updateCachedMaxReadSeq(n4[0], { maxSeq: s2[1], maxSeqTime: s2[2] });
                                }
                                i4 = a5 + 1;
                              });
                            });
                          });
                        }, function(t4) {
                          throw s.default.error("Sync message from server error", t4, e5), t4;
                        });
                      });
                    }
                  })();
                  return f2 && f2.then ? f2.then(u2) : u2();
                });
                return a3 && a3.then ? a3.then(r3) : r3();
              }
              s.default.debug("Nothing to sync");
            })());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.pullMsgBySeqRange = function(e3, t3) {
          try {
            var r3 = [].concat(e3.entries()).map(function(e4) {
              var t4 = e4[1];
              return { conversationID: e4[0], begin: t4[0], end: t4[1], num: i2.defaultPullNums };
            });
            s.default.debug("PullMsgBySeqRange with opid: ", t3, "seqRanges: ", r3);
            var o3 = n.PbCoder.PullMessageBySeqsReq.encode({ userID: i2.instance.userID, seqRanges: r3, order: n.SdkWsProto.PullOrder.PullOrderAsc }).finish();
            return Promise.resolve(i2.instance.sendReqWaitResp({ operationID: t3, data: o3, reqIdentifier: exports.ReqIdentifier.PullMsgByRange }));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2;
      };
      function $e(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof Ze) {
            if (!r2.s) return void (r2.o = $e.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then($e.bind(null, e2, t2), $e.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          const n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var Ze = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          var n2 = new e2(), o2 = this.s;
          if (o2) {
            var i2 = 1 & o2 ? t2 : r2;
            if (i2) {
              try {
                $e(n2, 1, i2(this.v));
              } catch (e3) {
                $e(n2, 2, e3);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              var o3 = e3.v;
              1 & e3.s ? $e(n2, 1, t2 ? t2(o3) : o3) : r2 ? $e(n2, 1, r2(o3)) : $e(n2, 2, o3);
            } catch (e4) {
              $e(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      function et(e2) {
        return e2 instanceof Ze && 1 & e2.s;
      }
      var tt = "undefined" != typeof Symbol ? Symbol.iterator || (Symbol.iterator = /* @__PURE__ */ Symbol("Symbol.iterator")) : "@@iterator";
      function rt(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof ot) {
            if (!r2.s) return void (r2.o = rt.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(rt.bind(null, e2, t2), rt.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var nt = [exports.InternalMessageStatus.MsgStatusHasDeleted, exports.InternalMessageStatus.MsgStatusFiltered];
      var ot = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          var n2 = new e2(), o2 = this.s;
          if (o2) {
            var i2 = 1 & o2 ? t2 : r2;
            if (i2) {
              try {
                rt(n2, 1, i2(this.v));
              } catch (e3) {
                rt(n2, 2, e3);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              var o3 = e3.v;
              1 & e3.s ? rt(n2, 1, t2 ? t2(o3) : o3) : r2 ? rt(n2, 1, r2(o3)) : rt(n2, 2, o3);
            } catch (e4) {
              rt(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      var it = function(e2) {
        var t2 = this, r2 = this, i2 = this, a2 = this, u2 = this, c2 = this, d2 = this, p2 = this, g2 = this, f2 = this, v2 = this, h2 = this;
        this.instance = void 0, this.cache = void 0, this.syncer = void 0, this.triggeredConversationEvent = /* @__PURE__ */ new Map(), this.typingManager = void 0, this.sync = function(e3, t3) {
          try {
            return Promise.resolve(r2.cache.getMaxReadSeqs(e3)).then(function() {
              var n2 = [r2.syncer.syncConversationVersion(e3), r2.cache.getNotNotifyConversationIDs(e3)];
              return null != t3 && t3.skipGetActiveConversationsFromServer || n2.push(r2.cache.getActiveConversationsFromServer(e3)), Promise.resolve(Promise.all(n2)).then(function() {
              });
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.reset = function() {
          t2.cache.clear(), t2.syncer.reset(), t2.typingManager.reset(), t2.triggeredConversationEvent.clear();
        }, this.setTriggeredConversationEvent = function(e3) {
          t2.triggeredConversationEvent.set(e3, true);
        }, this.getMessageWithCacheBySeqs = function(e3, t3, r3) {
          try {
            var n2 = function() {
              return c3.sort(function(e4, t4) {
                return e4.seq - t4.seq;
              }), { messages: c3, filterCount: d3 };
            }, o2 = i2.cache.getCachedMessagesBySeqs(e3, t3), a3 = o2.cachedMessages, u3 = o2.unCachedSeqs, c3 = [].concat(a3), d3 = 0;
            s.default.debug("after getCachedMessagesBySeqs with opid: ", r3, "seqs: ", t3, "cachedMessages: ", a3, "unCachedSeqs: ", u3);
            var p3 = (function() {
              if (u3.length) return Promise.resolve(i2.getMessageFromServerBySeqs([{ conversationID: e3, seqs: u3 }], r3)).then(function(t4) {
                var r4 = [], n3 = [];
                t4.msgs[e3].Msgs.forEach(function(e4) {
                  nt.includes(e4.status) ? (r4.push(e4.seq), d3++) : n3.push(je(e4));
                }), t4.msgs[e3].Msgs.length || r4.push.apply(r4, u3), i2.cache.addMessagesToCache(e3, n3), i2.cache.addFilterSeqsToCache(e3, r4), c3.push.apply(c3, n3);
              });
            })();
            return Promise.resolve(p3 && p3.then ? p3.then(n2) : n2());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getPreviousSeqMessage = function(e3) {
          var t3 = e3.conversationID, r3 = e3.seq, n2 = e3.operationID;
          try {
            if (!r3 || r3 < 1) return Promise.resolve(null);
            for (var o2 = [], i3 = r3; o2.length < 10 && !(i3 < 1); i3--) a2.cache.checkIsFilterSeq(t3, i3) || o2.push(i3);
            return Promise.resolve(a2.getMessageWithCacheBySeqs(t3, o2, n2)).then(function(e4) {
              var r4, i4 = e4.messages;
              function s2(e5) {
                return r4 ? e5 : i4[i4.length - 1];
              }
              var u3 = (function() {
                if (!i4.length) return Promise.resolve(a2.getPreviousSeqMessage({ seq: o2[o2.length - 1], operationID: n2, conversationID: t3 })).then(function(e5) {
                  return r4 = 1, e5;
                });
              })();
              return u3 && u3.then ? u3.then(s2) : s2(u3);
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.initConversation = function(e3) {
          try {
            var t3 = function(e4) {
              return u2.cache.setCachedConversations([r3]), r3;
            }, r3 = { conversationID: ae(l({}, e3, { userID: u2.instance.userID })), userID: "", groupID: "", recvMsgOpt: exports.MessageReceiveOptType.Nomal, unreadCount: 0, groupAtType: exports.GroupAtType.AtNormal, latestMsg: "", latestMsgSendTime: 0, draftText: "", draftTextTime: 0, burnDuration: 0, msgDestructTime: 0, isPinned: false, isPrivateChat: false, isMsgDestruct: false, attachedInfo: "", ex: "" }, n2 = e3.sessionType === exports.SessionType.Group ? Promise.resolve(u2.instance.groupTrigger.cache.getGroupInfosWithCache([e3.sourceID], e3.operationID)).then(function(t4) {
              if (!t4[0]) throw new Error("target group not exist");
              r3.showName = t4[0].groupName, r3.faceURL = t4[0].faceURL, r3.conversationType = exports.SessionType.Group, r3.groupID = e3.sourceID;
            }) : (r3.userID = e3.sourceID, r3.conversationType = exports.SessionType.Single, Promise.resolve(u2.instance.getSpecifiedFriendsInfo([e3.sourceID], e3.operationID)).then(function(t4) {
              var n3 = t4.data, o2 = (function() {
                if (!n3.length) return Promise.resolve(u2.instance.getUsersInfo([e3.sourceID], e3.operationID)).then(function(e4) {
                  var t5 = e4.data;
                  r3.showName = t5[0].nickname, r3.faceURL = t5[0].faceURL;
                });
                r3.showName = n3[0].remark || n3[0].nickname, r3.faceURL = n3[0].faceURL;
              })();
              if (o2 && o2.then) return o2.then(function() {
              });
            }));
            return Promise.resolve(n2 && n2.then ? n2.then(t3) : t3());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getConversationsWithCacheByIDs = function(e3, t3) {
          try {
            var r3 = function() {
              return [].concat(o2, i3);
            }, o2 = [], i3 = [], s2 = [];
            e3.forEach(function(e4) {
              var t4 = c2.cache.getCachedConversation(e4);
              t4 ? o2.push(t4) : s2.push(e4);
            });
            var a3 = (function() {
              if (s2.length) return Promise.resolve(c2.instance.sendHttpRequest({ reqFuncName: C.GetDesignatedConversation, data: n.PbCoder.GetConversationsReq.encode({ ownerUserID: c2.instance.userID, conversationIDs: s2 }).finish(), operationID: t3 })).then(function(e4) {
                var t4, r4 = de(e4, C.GetDesignatedConversation), n2 = null != (t4 = null == r4 ? void 0 : r4.conversations) ? t4 : [], o3 = i3.push;
                return Promise.resolve(Promise.all(n2.map(function(e5) {
                  var t5, r5;
                  return _e(e5, c2.getPreviousSeqMessage, null == (t5 = c2.cache.getCachedMaxReadSeq(null == (r5 = e5.conversation) ? void 0 : r5.conversationID)) ? void 0 : t5.maxSeqTime);
                }))).then(function(e5) {
                  o3.call.apply(o3, [i3].concat(e5)), c2.cache.setCachedConversations(i3);
                  var t5 = s2.filter(function(e6) {
                    return !n2.find(function(t6) {
                      var r5;
                      return (null == (r5 = t6.conversation) ? void 0 : r5.conversationID) === e6;
                    });
                  });
                  t5.forEach(function(e6) {
                    c2.cache.removeCachedMaxReadSeq(e6);
                  });
                });
              });
            })();
            return Promise.resolve(a3 && a3.then ? a3.then(r3) : r3());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getOneConversationAndTryChange = function(e3, t3, r3, o2, i3) {
          try {
            var a3, u3 = function(e4) {
              return a3 ? e4 : (c3 && r3 && d2.instance.triggerEvent({ event: i3 ? exports.CbEvents.OnNewConversation : exports.CbEvents.OnConversationChanged, data: [l({}, c3)], operationID: t3 }), c3);
            }, c3 = void 0;
            c3 = d2.cache.getCachedConversation(e3);
            var p3 = (function() {
              if (!c3) return (function() {
                if (d2.cache.getCachedMaxReadSeq(e3)) return Promise.resolve(d2.instance.sendHttpRequest({ reqFuncName: C.GetDesignatedConversation, data: n.PbCoder.GetConversationsReq.encode({ ownerUserID: d2.instance.userID, conversationIDs: [e3] }).finish(), operationID: t3 })).then(function(t4) {
                  var r4, n2, o3 = de(t4, C.GetDesignatedConversation), i5 = null != (r4 = null == o3 ? void 0 : o3.conversations) ? r4 : [];
                  if (i5.length) return Promise.resolve(_e(i5[0], d2.getPreviousSeqMessage, null == (n2 = d2.cache.getCachedMaxReadSeq(e3)) ? void 0 : n2.maxSeqTime)).then(function(e4) {
                    d2.cache.setCachedConversations([c3 = e4]);
                  });
                  a3 = 1;
                });
              })();
              var i4;
              void 0 !== (null == (i4 = r3) ? void 0 : i4.recvMsgOpt) && (r3.recvMsgOpt === exports.MessageReceiveOptType.Nomal ? d2.cache.deleteNotNotifyConversationID(e3) : d2.cache.addNotNotifyConversationID(e3)), r3 && (void 0 !== r3.latestMsg && "string" != typeof r3.latestMsg && (s.default.error("[getOneConversationAndTryChange] updateFields.latestMsg is not a string \u2014 coercing", { type: typeof r3.latestMsg, value: r3.latestMsg, stack: new Error().stack, conversationID: e3, operationID: t3 }), r3 = l({}, r3, { latestMsg: JSON.stringify(r3.latestMsg) })), Object.assign(c3, r3)), o2 && (c3.unreadCount += 1);
            })();
            return Promise.resolve(p3 && p3.then ? p3.then(u3) : u3(p3));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getMessageFromServerBySeqs = function(e3, t3) {
          try {
            var r3 = n.PbCoder.GetSeqMessageReq.encode({ userID: p2.instance.userID, conversations: e3, order: o.PullOrder.PullOrderAsc }).finish();
            return Promise.resolve(p2.instance.sendReqWaitResp({ operationID: t3, data: r3, reqIdentifier: exports.ReqIdentifier.PullMsgBySeqList }));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.revokeMessage = function(e3, t3) {
          try {
            return Promise.resolve(g2.getMessageWithCacheBySeqs(e3.conversationID, [e3.seq], t3)).then(function(r3) {
              function n2() {
                function r4() {
                  var r5, o3;
                  g2.instance.triggerEvent({ event: exports.CbEvents.OnNewRecvMessageRevoked, data: n3, operationID: t3 });
                  var i4 = null != (r5 = null == (o3 = g2.cache.getCachedMaxReadSeq(e3.conversationID)) ? void 0 : o3.maxSeq) ? r5 : 0, a4 = (function() {
                    if (i4 <= e3.seq) return g2.cache.updateCachedMaxReadSeq(e3.conversationID, { maxSeqTime: e3.revokeTime }), Promise.resolve(g2.getOneConversationAndTryChange(e3.conversationID, t3, { latestMsg: JSON.stringify(Be(s2)), latestMsgSendTime: e3.revokeTime })).then(function() {
                    });
                  })();
                  if (a4 && a4.then) return a4.then(function() {
                  });
                }
                var n3 = { revokerID: e3.revokerUserID, revokerRole: i3, clientMsgID: o2.clientMsgID, revokerNickname: a3, revokeTime: e3.revokeTime, sourceMessageSendTime: o2.sendTime, sourceMessageSendID: o2.sendID, sourceMessageSenderNickname: o2.senderNickname, sessionType: e3.sesstionType, seq: e3.seq, ex: "", isAdminRevoke: e3.isAdminRevoke }, s2 = g2.cache.tryUpdateCachedMessages(e3.conversationID, { clientMsgID: e3.clientMsgID, seq: e3.seq, content: JSON.stringify({ detail: JSON.stringify(n3) }), contentType: exports.NotificationType.RevokeNotification });
                g2.cache.tryUpdateQuotedMessage(e3.conversationID, e3.clientMsgID);
                var u4 = (function() {
                  if (!s2) return Promise.resolve(g2.getMessageFromServerBySeqs([{ conversationID: e3.conversationID, seqs: [e3.seq] }], t3)).then(function(t4) {
                    s2 = je(t4.msgs[e3.conversationID].Msgs[0]);
                  });
                })();
                return u4 && u4.then ? u4.then(r4) : r4();
              }
              var o2 = r3.messages[0];
              if (o2) {
                var i3 = 0, a3 = "", u3 = (function() {
                  if (e3.isAdminRevoke || e3.sesstionType === exports.SessionType.Single) return Promise.resolve(g2.instance.getUsersInfo([e3.revokerUserID], t3)).then(function(e4) {
                    var t4;
                    a3 = null == (t4 = e4.data[0]) ? void 0 : t4.nickname;
                  });
                  var r4 = (function() {
                    if (e3.sesstionType === exports.SessionType.Group) return Promise.resolve(g2.getOneConversationAndTryChange(e3.conversationID, t3)).then(function(r5) {
                      return Promise.resolve(g2.instance.groupTrigger.cache.getGroupMembersWithCache({ groupID: r5.groupID, userIDList: [e3.revokerUserID], operationID: t3 })).then(function(e4) {
                        var t4, r6;
                        a3 = null == (t4 = e4[0]) ? void 0 : t4.nickname, i3 = null == (r6 = e4[0]) ? void 0 : r6.roleLevel;
                      });
                    });
                  })();
                  return r4 && r4.then ? r4.then(function() {
                  }) : void 0;
                })();
                return u3 && u3.then ? u3.then(n2) : n2();
              }
              s.default.warn("revoke source message not found", e3);
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.triggerTyping = function(e3) {
          e3.sendID !== t2.instance.userID && t2.typingManager.onNewMessage(e3);
        }, this.triggerNotification = function(e3, t3) {
          try {
            for (var r3 = 0, n2 = Object.entries(e3); r3 < n2.length; r3++) n2[r3][1].Msgs.map(function(e4) {
              e4.contentType > exports.NotificationType.FriendNotificationBegin && e4.contentType < exports.NotificationType.FriendNotificationEnd ? (s.default.debug("Trigger friend notification", e4), f2.instance.relationTrigger.parseMessageAndTrigger(e4, t3)) : e4.contentType > exports.NotificationType.UserNotificationBegin && e4.contentType < exports.NotificationType.UserNotificationEnd ? (s.default.debug("Trigger user notification", e4), f2.instance.userTrigger.parseMessageAndTrigger(e4, t3)) : e4.contentType > exports.NotificationType.GroupNotificationBegin && e4.contentType < exports.NotificationType.GroupNotificationEnd ? (s.default.debug("Trigger group notification", e4), f2.instance.groupTrigger.parseMessageAndTrigger(e4, t3)) : e4.contentType === exports.NotificationType.BusinessNotification ? (s.default.debug("Trigger business notification", e4), f2.instance.businessTrigger.parseMessageAndTrigger(e4, t3)) : e4.contentType > exports.NotificationType.SignalingNotificationBegin && e4.contentType < exports.NotificationType.SignalingNotificationEnd ? s.default.debug("Trigger signaling notification", e4) : f2.triggerConversationNotification(e4, t3);
            });
            return Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.triggerConversationNotification = function(e3, t3) {
          try {
            return s.default.debug("Trigger conversation notification with opid: ", t3, "messageType: ", e3.contentType), Promise.resolve((function(e4, t4) {
              var r3, n2 = -1;
              e: {
                for (var o2 = 0; o2 < t4.length; o2++) {
                  var i3 = t4[o2][0];
                  if (i3) {
                    var s2 = i3();
                    if (s2 && s2.then) break e;
                    if (s2 === e4) {
                      n2 = o2;
                      break;
                    }
                  } else n2 = o2;
                }
                if (-1 !== n2) {
                  do {
                    for (var a3 = t4[n2][1]; !a3; ) n2++, a3 = t4[n2][1];
                    var u3 = a3();
                    if (u3 && u3.then) {
                      r3 = true;
                      break e;
                    }
                    var c3 = t4[n2][2];
                    n2++;
                  } while (c3 && !c3());
                  return u3;
                }
              }
              var d3 = new ot(), p3 = rt.bind(null, d3, 2);
              return (r3 ? u3.then(g3) : s2.then(function r4(s3) {
                for (; ; ) {
                  if (s3 === e4) {
                    n2 = o2;
                    break;
                  }
                  if (++o2 === t4.length) {
                    if (-1 !== n2) break;
                    return void rt(d3, 1, u4);
                  }
                  if (i3 = t4[o2][0]) {
                    if ((s3 = i3()) && s3.then) return void s3.then(r4).then(void 0, p3);
                  } else n2 = o2;
                }
                do {
                  for (var a4 = t4[n2][1]; !a4; ) n2++, a4 = t4[n2][1];
                  var u4 = a4();
                  if (u4 && u4.then) return void u4.then(g3).then(void 0, p3);
                  var c4 = t4[n2][2];
                  n2++;
                } while (c4 && !c4());
                rt(d3, 1, u4);
              })).then(void 0, p3), d3;
              function g3(e5) {
                for (; ; ) {
                  var r4 = t4[n2][2];
                  if (!r4 || r4()) break;
                  n2++;
                  for (var o3 = t4[n2][1]; !o3; ) n2++, o3 = t4[n2][1];
                  if ((e5 = o3()) && e5.then) return void e5.then(g3).then(void 0, p3);
                }
                rt(d3, 1, e5);
              }
            })(e3.contentType, [[function() {
              return exports.NotificationType.ConversationChangeNotification;
            }, function() {
              return Promise.resolve(v2.syncer.syncConversationVersion(t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.ConversationPrivateChatNotification;
            }, function() {
              return Promise.resolve(v2.syncer.syncConversationVersion(t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.RevokeNotification;
            }, function() {
              var r3 = Ve(e3.content);
              return v2.triggeredConversationEvent.has(t3) ? void v2.triggeredConversationEvent.delete(t3) : void v2.revokeMessage(r3, t3);
            }], [function() {
              return exports.NotificationType.ClearConversationNotification;
            }, function() {
            }], [function() {
              return exports.NotificationType.DeleteMsgsNotification;
            }, function() {
              var r3 = Ve(e3.content), n2 = r3.seqs.find(function(e4) {
                var t4;
                return e4 === (null == (t4 = v2.cache.getCachedMaxReadSeq(r3.conversationID)) ? void 0 : t4.hasReadSeq);
              }), o2 = (function() {
                if (n2) return Promise.resolve(v2.getMessageWithCacheBySeqs(r3.conversationID, [n2 - 1], t3)).then(function(n3) {
                  var o3 = n3.messages[0], i3 = (function() {
                    if (o3) return v2.cache.updateCachedMaxReadSeq(r3.conversationID, { maxSeqTime: e3.sendTime }), Promise.resolve(v2.getOneConversationAndTryChange(r3.conversationID, t3, { latestMsg: JSON.stringify(Be(o3)), latestMsgSendTime: o3.sendTime })).then(function() {
                    });
                  })();
                  if (i3 && i3.then) return i3.then(function() {
                  });
                });
              })();
              return o2 && o2.then ? o2.then(function() {
              }) : void 0;
            }], [function() {
              return exports.NotificationType.HasReadReceipt;
            }, function() {
              var r3 = Ve(e3.content);
              if (r3.markAsReadUserID !== v2.instance.userID && r3.seqs.length) return Promise.resolve(v2.getMessageWithCacheBySeqs(r3.conversationID, r3.seqs, t3)).then(function(n2) {
                var o2 = n2.messages;
                function i3() {
                  v2.cache.decreaseTotalUnreadCount(r3.seqs.length, t3), v2.cache.updateCachedMaxReadSeq(r3.conversationID, { hasReadSeq: r3.hasReadSeq });
                }
                var a3 = { userID: r3.markAsReadUserID, groupID: "", msgIDList: o2.map(function(e4) {
                  return e4.clientMsgID;
                }), readTime: e3.sendTime, msgFrom: 0, contentType: 0, sessionType: o2[0].sessionType };
                s.default.debug("receipt", a3), v2.cache.markCachedMessagesAsRead(r3.conversationID, r3.seqs), v2.instance.triggerEvent({ event: exports.CbEvents.OnRecvC2CReadReceipt, data: [a3], operationID: t3 });
                var u3 = o2.find(function(e4) {
                  return e4.seq === r3.hasReadSeq;
                }), c3 = (function() {
                  if (u3) {
                    u3.isRead = true;
                    var e4 = JSON.stringify(Be(u3));
                    return Promise.resolve(v2.getOneConversationAndTryChange(r3.conversationID, t3, { unreadCount: 0, latestMsg: e4 })).then(function() {
                    });
                  }
                })();
                return c3 && c3.then ? c3.then(i3) : i3();
              });
            }], [function() {
              return exports.NotificationType.HasGroupReadReceipt;
            }, function() {
            }], []]));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.triggerConversation = function(e3, t3) {
          try {
            if (0 === Object.keys(e3).length) return Promise.resolve();
            s.default.debug("Trigger conversation", e3);
            var r3 = true;
            h2.triggeredConversationEvent.has(t3) && (h2.triggeredConversationEvent.delete(t3), r3 = false);
            for (var n2 = false, o2 = h2.cache.getTotalUnreadCount(), i3 = [], a3 = [], u3 = function() {
              var e4 = d3[c3], u4 = e4[0];
              e4[1].Msgs.map(function(e5) {
                var c4, d4, p3, g3, l2 = !h2.cache.getCachedMaxReadSeq(u4), f3 = e5.sendID === h2.instance.userID, v3 = ue(e5.options, exports.MessageOptionsKey.IsUnreadCount) && !f3, m2 = ue(e5.options, exports.MessageOptionsKey.IsConversationUpdate), I2 = ue(e5.options, exports.MessageOptionsKey.IsNotPrivate), M2 = ue(e5.options, exports.MessageOptionsKey.IsHistory);
                if (e5.clientMsgID && u4) {
                  var y2 = je(e5), D2 = Be(y2);
                  if (D2.attachedInfoElem = e5.attachedInfo ? JSON.parse(e5.attachedInfo) : { groupHasReadInfo: { hasReadCount: 0, unreadCount: 0 }, isPrivateChat: false, burnDuration: 0, hasReadTime: 0, messageEntityList: [], isEncryption: false, inEncryptStatus: false }, e5.status !== exports.InternalMessageStatus.MsgStatusHasDeleted) {
                    if (e5.contentType === exports.InternalContentType.Typing && h2.triggerTyping(D2), D2.status = exports.InternalMessageStatus.MsgStatusSendSuccess, y2.status = exports.InternalMessageStatus.MsgStatusSendSuccess, l2 && h2.cache.addCachedMaxReadSeq(u4, { hasReadSeq: f3 ? e5.seq : e5.seq - 1, maxSeq: e5.seq, maxSeqTime: e5.sendTime, subtractUnread: 0 }), I2 || (D2.attachedInfoElem.isPrivateChat = true), M2 || a3.push(y2), m2) {
                      var C2, S2, T2 = null != (C2 = null == (S2 = h2.cache.getCachedMaxReadSeq(u4)) ? void 0 : S2.maxSeq) ? C2 : 0, x2 = l2 || D2.seq > T2;
                      !x2 && v3 && s.default.debug("triggerConversation: skip unread bump; seq does not advance maxSeq", { conversationID: u4, seq: D2.seq, currentMaxSeq: T2, contentType: D2.contentType, operationID: t3 }), x2 && (o2 += v3 ? 1 : 0), h2.cache.updateCachedMaxReadSeq(u4, { maxSeqTime: D2.sendTime }), r3 && h2.getOneConversationAndTryChange(u4, t3, { latestMsg: JSON.stringify(D2), latestMsgSendTime: D2.sendTime }, v3 && x2, l2), i3.push(y2), h2.cache.addMessagesToCache(u4, [y2]);
                    }
                    var b2 = null != (c4 = null == (d4 = h2.cache.getCachedMaxReadSeq(u4)) ? void 0 : d4.maxSeq) ? c4 : 0, A2 = null != (p3 = null == (g3 = h2.cache.getCachedMaxReadSeq(u4)) ? void 0 : g3.hasReadSeq) ? p3 : 0;
                    s.default.debug("currentMaxSeq", b2, "currentHasReadSeq", A2), D2.seq > b2 && (n2 = l2 || !h2.cache.isNotNotifyConversation(u4), h2.cache.updateCachedMaxReadSeq(u4, { maxSeq: b2 + 1, maxSeqTime: D2.sendTime }), f3 && (h2.cache.updateCachedMaxReadSeq(u4, { hasReadSeq: A2 + 1 }), h2.cache.tryUpdateCachedMessages(u4, { clientMsgID: D2.clientMsgID, seq: D2.seq })));
                  }
                }
              });
            }, c3 = 0, d3 = Object.entries(e3); c3 < d3.length; c3++) u3();
            if (r3 && n2 && h2.cache.setTotalUnreadCount(o2, t3), a3.length > 0 && h2.instance.triggerEvent({ event: exports.CbEvents.OnRecvOnlineOnlyMessages, data: a3.map(Be), operationID: t3 }), i3.length > 0) {
              if (!r3) return i3.map(function(e4) {
                h2.cache.tryUpdateCachedMessages(se(e4), e4);
              }), Promise.resolve();
              h2.instance.triggerEvent({ event: exports.CbEvents.OnRecvNewMessages, data: i3.map(Be), operationID: t3 });
            }
            return Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2, this.cache = new ze(e2), this.syncer = new Xe(e2), this.typingManager = new Qe(e2);
      };
      var st = /* @__PURE__ */ (function() {
        function e2(e3) {
          var t2 = this, r2 = this, n2 = this, o2 = this;
          this.instance = void 0, this.cachedGroups = /* @__PURE__ */ new Map(), this.cachedGroupMembers = /* @__PURE__ */ new Map(), this.cachedGroupMembersID = /* @__PURE__ */ new Map(), this.getGroupMembersID = function(e4, t3) {
            try {
              return Promise.resolve(r2.instance.sendHttpRequest({ reqFuncName: C.GetFullGroupMemberUserIDs, data: { groupID: e4, idHash: 0 }, operationID: t3 })).then(function(t4) {
                r2.cachedGroupMembersID.set(e4, t4.userIDs);
              });
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.getGroupInfosWithCache = function(e4, t3) {
            try {
              var r3 = [], o3 = [];
              return e4.forEach(function(e5) {
                var t4 = n2.cachedGroups.get(e5);
                t4 ? r3.push(t4) : o3.push(e5);
              }), o3.length ? Promise.resolve(n2.instance.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSpecifiedGroupsInfo, data: { groupIDs: o3 }, operationID: t3 })).then(function(e5) {
                var t4 = e5.groupInfos;
                return t4 && t4.forEach(function(e6) {
                  return n2.cachedGroups.set(e6.groupID, e6);
                }), [].concat(r3, null != t4 ? t4 : []);
              }) : Promise.resolve(r3);
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.getGroupMembersWithCache = function(e4) {
            var t3 = e4.groupID, r3 = e4.userIDList, n3 = e4.operationID;
            try {
              var i2, s2, a2 = null != (i2 = o2.cachedGroupMembers.get(t3)) ? i2 : [], u2 = (function() {
                if (null != r3 && r3.length) {
                  var e5 = [], i3 = [];
                  return r3.forEach(function(t4) {
                    var r4 = a2.find(function(e6) {
                      return e6.userID === t4;
                    });
                    r4 ? i3.push(r4) : e5.push(t4);
                  }), e5.length ? Promise.resolve(o2.instance.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSpecifiedGroupMembersInfo, data: { groupID: t3, userIDs: e5 }, operationID: n3 })).then(function(e6) {
                    var r4 = e6.members;
                    r4 && o2.cachedGroupMembers.set(t3, [].concat(a2, r4));
                    var n4 = [].concat(i3, null != r4 ? r4 : []);
                    return s2 = 1, n4;
                  }) : (s2 = 1, i3);
                }
              })();
              return Promise.resolve(u2 && u2.then ? u2.then(function(e5) {
                return s2 ? e5 : a2;
              }) : s2 ? u2 : a2);
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.updateCachedGroups = function(e4) {
            e4.map(function(e5) {
              t2.cachedGroups.set(e5.groupID, e5);
            });
          }, this.updateCachedGroupMembers = function(e4) {
            var r3, n3, o3;
            if (e4.length && null != (r3 = e4[0]) && r3.groupID) {
              var i2 = e4[0].groupID, a2 = null != (n3 = t2.cachedGroupMembers.get(i2)) ? n3 : [];
              t2.cachedGroupMembers.set(i2, [].concat(a2.filter(function(t3) {
                return !e4.find(function(e5) {
                  return e5.userID === t3.userID;
                });
              }), e4));
              var u2 = t2.instance.messageTrigger.cache.getAllCachedConversations().find(function(t3) {
                return t3.groupID === e4[0].groupID;
              }), c2 = null != (o3 = (function(e5, t3) {
                if (null == e5 || "" === e5) return null;
                if ("string" == typeof e5) try {
                  return JSON.parse(e5);
                } catch (r4) {
                  return s.default.warn("[safeParseCachedJson] " + t3.site + ": parse " + t3.field + " failed", l({ error: r4, raw: e5, operationID: t3.operationID }, t3.extra)), null;
                }
                return s.default.error("[safeParseCachedJson] " + t3.site + ": " + t3.field + " is " + typeof e5 + ", expected string. Upstream writer violated the string contract.", l({ type: typeof e5, value: e5, operationID: t3.operationID, stack: new Error().stack }, t3.extra)), e5;
              })(null == u2 ? void 0 : u2.latestMsg, { site: "GroupCache.updateCachedGroupMembers", field: "latestMsg" })) ? o3 : {}, d2 = e4.find(function(e5) {
                return e5.userID === c2.sendID && e5.nickname !== c2.senderNickname;
              });
              u2 && d2 && t2.instance.messageTrigger.getOneConversationAndTryChange(u2.conversationID, "", { latestMsg: JSON.stringify(l({}, c2, { senderNickname: d2.nickname })) });
            }
          }, this.clearCachedGroupMembers = function(e4) {
            t2.cachedGroupMembers.delete(e4);
          }, this.hasCachedGroupMembersID = function(e4) {
            return t2.cachedGroupMembersID.has(e4);
          }, this.getCachedGroupMembersID = function(e4) {
            var r3;
            return null != (r3 = t2.cachedGroupMembersID.get(e4)) ? r3 : [];
          }, this.tryAddCachedGroupMembersID = function(e4, r3) {
            if (t2.cachedGroupMembersID.has(e4)) {
              var n3, o3 = null != (n3 = t2.cachedGroupMembersID.get(e4)) ? n3 : [];
              t2.cachedGroupMembersID.set(e4, [].concat(o3, r3));
            }
          }, this.tryDeleteCachedGroupMembersID = function(e4, r3) {
            if (t2.cachedGroupMembersID.has(e4)) {
              var n3, o3 = null != (n3 = t2.cachedGroupMembersID.get(e4)) ? n3 : [];
              t2.cachedGroupMembersID.set(e4, o3.filter(function(e5) {
                return !r3.includes(e5);
              }));
            }
          }, this.instance = e3;
        }
        return e2.prototype.clear = function() {
          this.cachedGroups.clear(), this.cachedGroupMembers.clear(), this.cachedGroupMembersID.clear();
        }, e2;
      })();
      var at = /* @__PURE__ */ (function() {
        function e2(e3) {
          var t2 = this, r2 = this, n2 = this, o2 = this;
          this.instance = void 0, this.syncedGroupsVersion = 0, this.syncedGroupsVersionID = "", this.syncedGroupMemberVersion = {}, this.syncGroupVersion = function(e4) {
            try {
              return Promise.resolve(r2.instance.sendHttpRequest({ reqFuncName: C.GetGroupVersion, data: { userID: r2.instance.userID, version: r2.syncedGroupsVersion, versionID: r2.syncedGroupsVersionID }, operationID: e4 })).then(function(t3) {
                r2.syncedGroupsVersionID && r2.compareGroupVersionAndTrigger(t3, e4), r2.syncedGroupsVersion = t3.version, r2.syncedGroupsVersionID = t3.versionID;
              });
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.syncGroupInfoAndMemberVersion = function(e4) {
            try {
              var t3 = function() {
                if (r3.length) return Promise.resolve(n2.instance.sendHttpRequest({ reqFuncName: C.GetGroupMemberVersion, data: { userID: n2.instance.userID, reqList: r3 }, operationID: e4 })).then(function(t4) {
                  var r4 = t4.respList;
                  Object.keys(n2.syncedGroupMemberVersion).length > 0 && n2.compareGroupMemberVersionAndTrigger(r4, e4), n2.syncedGroupMemberVersion = r4;
                  for (var o4 = 0, i3 = Object.entries(r4); o4 < i3.length; o4++) {
                    var s2 = i3[o4][1];
                    s2.group && n2.instance.groupTrigger.cache.updateCachedGroups([s2.group]), (s2.insert || s2.update) && n2.instance.groupTrigger.cache.updateCachedGroupMembers(s2.insert || s2.update);
                  }
                });
              }, r3 = [], o3 = Object.keys(n2.syncedGroupMemberVersion), i2 = (function() {
                if (!o3.length) return Promise.resolve(n2.getJoinedGroupIDs(e4)).then(function(e5) {
                  r3 = e5.map(function(e6) {
                    return { groupID: e6, version: 0, versionID: "" };
                  });
                });
                r3 = o3.map(function(e5) {
                  var t4, r4, o4 = n2.syncedGroupMemberVersion[e5];
                  return { groupID: e5, version: null != (t4 = null == o4 ? void 0 : o4.version) ? t4 : 0, versionID: null != (r4 = null == o4 ? void 0 : o4.versionID) ? r4 : "" };
                });
              })();
              return Promise.resolve(i2 && i2.then ? i2.then(t3) : t3());
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.compareGroupVersionAndTrigger = function(e4, r3) {
            var n3 = e4.insert, o3 = e4.delete;
            (null != n3 ? n3 : []).map(function(e5) {
              t2.instance.triggerEvent({ event: exports.CbEvents.OnJoinedGroupAdded, data: e5, operationID: r3 });
            }), (null != o3 ? o3 : []).map(function(e5) {
              t2.instance.triggerEvent({ event: exports.CbEvents.OnJoinedGroupDeleted, data: { groupID: e5 }, operationID: r3 }), t2.instance.groupTrigger.cache.clearCachedGroupMembers(e5);
            });
          }, this.compareGroupMemberVersionAndTrigger = function(e4, r3) {
            for (var n3 = function() {
              var e5 = i2[o3], n4 = e5[0], s2 = e5[1], a2 = s2.group, u2 = s2.insert, c2 = s2.update, d2 = s2.delete;
              a2 && (t2.instance.groupTrigger.updateCachedGroupInfoAndTrigger(a2, r3), t2.instance.groupTrigger.checkConversationUpdate(a2)), (null != u2 ? u2 : []).map(function(e6) {
                t2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberAdded, data: e6, operationID: r3 });
              }), (null != c2 ? c2 : []).map(function(e6) {
                return t2.instance.groupTrigger.updateCachedGroupMemberInfoAndTrigger(e6, r3);
              }), (null != d2 ? d2 : []).map(function(e6) {
                t2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberDeleted, data: { groupID: n4, userID: e6 }, operationID: r3 });
              });
            }, o3 = 0, i2 = Object.entries(e4); o3 < i2.length; o3++) n3();
          }, this.getJoinedGroupIDs = function(e4) {
            try {
              return Promise.resolve(o2.instance.sendHttpRequest({ reqFuncName: C.GetJoinedGroupIDList, data: { idHash: 0, userID: o2.instance.userID }, operationID: e4 })).then(function(e5) {
                var t3 = e5.groupIDs;
                return null != t3 ? t3 : [];
              });
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.addGroupMemberVersion = function(e4, r3) {
            t2.syncedGroupMemberVersion[e4] = l({}, r3);
          }, this.updateGroupMemberVersion = function(e4, r3) {
            t2.syncedGroupMemberVersion[e4] ? t2.syncedGroupMemberVersion[e4] = l({}, r3) : s.default.warn("updateGroupMemberVersion: group member version not found", e4, "new version", r3);
          }, this.checkIsJoinGroup = function(e4) {
            return !!t2.syncedGroupMemberVersion[e4];
          }, this.instance = e3;
        }
        return e2.prototype.reset = function() {
          this.syncedGroupsVersion = 0, this.syncedGroupsVersionID = "", this.syncedGroupMemberVersion = {};
        }, e2;
      })();
      function ut(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof dt) {
            if (!r2.s) return void (r2.o = ut.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(ut.bind(null, e2, t2), ut.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var ct = /* @__PURE__ */ (function() {
        function e2(e3) {
          var t2, r2 = this, n2 = this, o2 = this;
          this.instance = void 0, this.cache = void 0, this.syncer = void 0, this.triggeredEventMap = ((t2 = {})[exports.CbEvents.OnGroupApplicationAdded] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnGroupApplicationAccepted] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnGroupApplicationRejected] = /* @__PURE__ */ new Map(), t2), this.sync = function(e4) {
            var t3 = [o2.syncer.syncGroupVersion(e4), o2.syncer.syncGroupInfoAndMemberVersion(e4)];
            return Promise.all(t3);
          }, this.setTriggeredEventMap = function(e4, t3) {
            o2.triggeredEventMap[e4].set(t3, true);
          }, this.checkConversationUpdate = function(e4) {
            var t3 = "sg_" + e4.groupID, r3 = o2.instance.messageTrigger.cache.getCachedConversation(t3);
            !r3 || r3.showName === e4.groupName && r3.faceURL === e4.faceURL || o2.instance.messageTrigger.getOneConversationAndTryChange(t3, "", { showName: e4.groupName, faceURL: e4.faceURL });
          }, this.getDesignatedGroupApplicationAndTrigger = function(e4) {
            var t3 = e4.event, n3 = e4.userID, o3 = e4.groupID, i2 = e4.operationID, s2 = e4.activeTrigger, a2 = void 0 !== s2 && s2;
            try {
              return !a2 && r2.triggeredEventMap[t3].has(i2) ? (r2.triggeredEventMap[t3].delete(i2), Promise.resolve()) : Promise.resolve(r2.instance.sendHttpRequest({ reqFuncName: C.GetDesignatedGroupApplication, data: { groupID: o3, userID: null != n3 ? n3 : r2.instance.userID }, operationID: i2 })).then(function(e5) {
                var n4 = e5.groupRequests;
                n4 && r2.instance.triggerEvent({ event: t3, operationID: i2, data: n4.map(Le)[0] });
              });
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.updateCachedGroupInfoAndTrigger = function(e4, t3) {
            o2.cache.updateCachedGroups([e4]), o2.instance.triggerEvent({ event: exports.CbEvents.OnGroupInfoChanged, data: e4, operationID: t3 });
          }, this.updateCachedGroupMemberInfoAndTrigger = function(e4, t3) {
            o2.cache.updateCachedGroupMembers([e4]), o2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberInfoChanged, data: e4, operationID: t3 });
          }, this.parseMessageAndTrigger = function(e4, t3) {
            try {
              var r3 = (function(e5, t4) {
                var r4, n3 = -1;
                e: {
                  for (var o3 = 0; o3 < t4.length; o3++) {
                    var i2 = t4[o3][0];
                    if (i2) {
                      var s2 = i2();
                      if (s2 && s2.then) break e;
                      if (s2 === e5) {
                        n3 = o3;
                        break;
                      }
                    } else n3 = o3;
                  }
                  if (-1 !== n3) {
                    do {
                      for (var a2 = t4[n3][1]; !a2; ) n3++, a2 = t4[n3][1];
                      var u2 = a2();
                      if (u2 && u2.then) {
                        r4 = true;
                        break e;
                      }
                      var c2 = t4[n3][2];
                      n3++;
                    } while (c2 && !c2());
                    return u2;
                  }
                }
                var d2 = new dt(), p2 = ut.bind(null, d2, 2);
                return (r4 ? u2.then(g2) : s2.then(function r5(s3) {
                  for (; ; ) {
                    if (s3 === e5) {
                      n3 = o3;
                      break;
                    }
                    if (++o3 === t4.length) {
                      if (-1 !== n3) break;
                      return void ut(d2, 1, u3);
                    }
                    if (i2 = t4[o3][0]) {
                      if ((s3 = i2()) && s3.then) return void s3.then(r5).then(void 0, p2);
                    } else n3 = o3;
                  }
                  do {
                    for (var a3 = t4[n3][1]; !a3; ) n3++, a3 = t4[n3][1];
                    var u3 = a3();
                    if (u3 && u3.then) return void u3.then(g2).then(void 0, p2);
                    var c3 = t4[n3][2];
                    n3++;
                  } while (c3 && !c3());
                  ut(d2, 1, u3);
                })).then(void 0, p2), d2;
                function g2(e6) {
                  for (; ; ) {
                    var r5 = t4[n3][2];
                    if (!r5 || r5()) break;
                    n3++;
                    for (var o4 = t4[n3][1]; !o4; ) n3++, o4 = t4[n3][1];
                    if ((e6 = o4()) && e6.then) return void e6.then(g2).then(void 0, p2);
                  }
                  ut(d2, 1, e6);
                }
              })(e4.contentType, [[function() {
                return exports.NotificationType.JoinGroupApplicationNotification;
              }, function() {
                var r4, o3, i2 = Ve(e4.content);
                return s.default.debug("Recv JoinGroupApplicationNotification with opid: ", t3, "tips: ", i2), Promise.resolve(n2.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationAdded, userID: null == (r4 = i2.applicant) ? void 0 : r4.userID, groupID: null == (o3 = i2.group) ? void 0 : o3.groupID, operationID: t3 })).then(function() {
                });
              }], [function() {
                return exports.NotificationType.GroupApplicationAcceptedNotification;
              }, function() {
                var r4, o3, i2 = Ve(e4.content);
                return s.default.debug("Recv GroupApplicationAcceptedNotification with opid: ", t3, "tips: ", i2), Promise.resolve(n2.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationAccepted, userID: i2.receiverAs ? null == (r4 = i2.opUser) ? void 0 : r4.userID : void 0, groupID: null == (o3 = i2.group) ? void 0 : o3.groupID, operationID: t3 })).then(function() {
                });
              }], [function() {
                return exports.NotificationType.GroupApplicationRejectedNotification;
              }, function() {
                var r4, o3, i2 = Ve(e4.content);
                return s.default.debug("Recv GroupApplicationRejectedNotification with opid: ", t3, "tips: ", i2), Promise.resolve(n2.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationRejected, userID: i2.receiverAs ? null == (r4 = i2.opUser) ? void 0 : r4.userID : void 0, groupID: null == (o3 = i2.group) ? void 0 : o3.groupID, operationID: t3 })).then(function() {
                });
              }], [function() {
                return exports.NotificationType.GroupCreatedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupCreatedNotification with opid: ", t3, "tips: ", r4), n2.cache.updateCachedGroups([r4.group]), Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                  n2.syncer.addGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID });
                });
              }], [function() {
                return exports.NotificationType.GroupInfoSetNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupInfoSetNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), n2.checkConversationUpdate(r4.group), void n2.updateCachedGroupInfoAndTrigger(r4.group, t3);
              }], [function() {
                return exports.NotificationType.MemberQuitNotification;
              }, function() {
                var r4, o3, i2, a2 = function() {
                  c2 || n2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberDeleted, data: u2.quitUser, operationID: t3 });
                }, u2 = Ve(e4.content);
                s.default.debug("Recv MemberQuitNotification with opid: ", t3, "tips: ", u2), n2.syncer.updateGroupMemberVersion(u2.group.groupID, { version: u2.groupMemberVersion, versionID: u2.groupMemberVersionID }), n2.updateCachedGroupInfoAndTrigger(u2.group, t3), n2.cache.tryDeleteCachedGroupMembersID(null == (r4 = u2.group) ? void 0 : r4.groupID, [null == (o3 = u2.quitUser) ? void 0 : o3.userID]);
                var c2 = (null == (i2 = u2.quitUser) ? void 0 : i2.userID) === n2.instance.userID, d2 = (function() {
                  if (c2) return Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                  });
                })();
                return d2 && d2.then ? d2.then(a2) : a2();
              }], [function() {
                return exports.NotificationType.GroupOwnerTransferredNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupOwnerTransferredNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), n2.updateCachedGroupInfoAndTrigger(r4.group, t3), n2.updateCachedGroupMemberInfoAndTrigger(r4.oldGroupOwnerInfo, t3), void n2.updateCachedGroupMemberInfoAndTrigger(r4.newGroupOwner, t3);
              }], [function() {
                return exports.NotificationType.MemberKickedNotification;
              }, function() {
                var r4, o3 = function() {
                  a2 || i2.kickedUserList.map(function(e5) {
                    return n2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberDeleted, data: e5, operationID: t3 });
                  });
                }, i2 = Ve(e4.content);
                s.default.debug("Recv MemberKickedNotification with opid: ", t3, "tips: ", i2), n2.syncer.updateGroupMemberVersion(i2.group.groupID, { version: i2.groupMemberVersion, versionID: i2.groupMemberVersionID }), n2.updateCachedGroupInfoAndTrigger(i2.group, t3), n2.cache.tryDeleteCachedGroupMembersID(null == (r4 = i2.group) ? void 0 : r4.groupID, i2.kickedUserList.map(function(e5) {
                  return e5.userID;
                }));
                var a2 = i2.kickedUserList.find(function(e5) {
                  return e5.userID === n2.instance.userID;
                }), u2 = (function() {
                  if (a2) return Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                  });
                })();
                return u2 && u2.then ? u2.then(o3) : o3();
              }], [function() {
                return exports.NotificationType.MemberInvitedNotification;
              }, function() {
                var r4 = function() {
                  var e5;
                  n2.syncer.updateGroupMemberVersion(o3.group.groupID, { version: o3.groupMemberVersion, versionID: o3.groupMemberVersionID }), n2.updateCachedGroupInfoAndTrigger(o3.group, t3), n2.checkConversationUpdate(o3.group), n2.cache.tryAddCachedGroupMembersID(null == (e5 = o3.group) ? void 0 : e5.groupID, o3.invitedUserList.map(function(e6) {
                    return e6.userID;
                  })), i2 || o3.invitedUserList.map(function(e6) {
                    return n2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberAdded, data: e6, operationID: t3 });
                  });
                }, o3 = Ve(e4.content);
                s.default.debug("Recv MemberInvitedNotification with opid: ", t3, "tips: ", o3);
                var i2 = o3.invitedUserList.find(function(e5) {
                  return e5.userID === n2.instance.userID;
                }), a2 = (function() {
                  if (i2) return Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                    n2.syncer.addGroupMemberVersion(o3.group.groupID, {});
                  });
                })();
                return a2 && a2.then ? a2.then(r4) : r4();
              }], [function() {
                return exports.NotificationType.MemberEnterNotification;
              }, function() {
                var r4, o3 = function() {
                  var e5, r5;
                  n2.syncer.updateGroupMemberVersion(i2.group.groupID, { version: i2.groupMemberVersion, versionID: i2.groupMemberVersionID }), n2.updateCachedGroupInfoAndTrigger(i2.group, t3), n2.checkConversationUpdate(i2.group), n2.cache.tryAddCachedGroupMembersID(null == (e5 = i2.group) ? void 0 : e5.groupID, [null == (r5 = i2.entrantUser) ? void 0 : r5.userID]), a2 || n2.instance.triggerEvent({ event: exports.CbEvents.OnGroupMemberAdded, data: i2.entrantUser, operationID: t3 });
                }, i2 = Ve(e4.content);
                s.default.debug("Recv MemberEnterNotification with opid: ", t3, "tips: ", i2);
                var a2 = (null == (r4 = i2.entrantUser) ? void 0 : r4.userID) === n2.instance.userID, u2 = (function() {
                  if (a2) return Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                    n2.syncer.addGroupMemberVersion(i2.group.groupID, {});
                  });
                })();
                return u2 && u2.then ? u2.then(o3) : o3();
              }], [function() {
                return exports.NotificationType.GroupDismissedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupDismissedNotification with opid: ", t3, "tips: ", r4), Promise.resolve(n2.syncer.syncGroupVersion(t3)).then(function() {
                  n2.updateCachedGroupInfoAndTrigger(r4.group, t3), n2.instance.triggerEvent({ event: exports.CbEvents.OnGroupDismissed, data: r4.group, operationID: t3 });
                });
              }], [function() {
                return exports.NotificationType.GroupMemberMutedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMemberMutedNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupMemberInfoAndTrigger(r4.mutedUser, t3);
              }], [function() {
                return exports.NotificationType.GroupMemberCancelMutedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMemberCancelMutedNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupMemberInfoAndTrigger(r4.mutedUser, t3);
              }], [function() {
                return exports.NotificationType.GroupMutedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMutedNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupInfoAndTrigger(r4.group, t3);
              }], [function() {
                return exports.NotificationType.GroupCancelMutedNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupCancelMutedNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupInfoAndTrigger(r4.group, t3);
              }], [function() {
                return exports.NotificationType.GroupMemberInfoSetNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMemberInfoSetNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupMemberInfoAndTrigger(r4.changedUser, t3);
              }], [function() {
                return exports.NotificationType.GroupMemberSetToAdminNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMemberSetToAdminNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupMemberInfoAndTrigger(r4.changedUser, t3);
              }], [function() {
                return exports.NotificationType.GroupMemberSetToOrdinaryUserNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupMemberSetToOrdinaryUserNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupMemberInfoAndTrigger(r4.changedUser, t3);
              }], [function() {
                return exports.NotificationType.GroupInfoSetAnnouncementNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupInfoSetAnnouncementNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), void n2.updateCachedGroupInfoAndTrigger(r4.group, t3);
              }], [function() {
                return exports.NotificationType.GroupInfoSetNameNotification;
              }, function() {
                var r4 = Ve(e4.content);
                return s.default.debug("Recv GroupInfoSetNameNotification with opid: ", t3, "tips: ", r4), n2.syncer.updateGroupMemberVersion(r4.group.groupID, { version: r4.groupMemberVersion, versionID: r4.groupMemberVersionID }), n2.checkConversationUpdate(r4.group), void n2.updateCachedGroupInfoAndTrigger(r4.group, t3);
              }], []]);
              return Promise.resolve(r3 && r3.then ? r3.then(function() {
              }) : void 0);
            } catch (e5) {
              return Promise.reject(e5);
            }
          }, this.instance = e3, this.cache = new st(e3), this.syncer = new at(e3);
        }
        return e2.prototype.reset = function() {
          var e3 = this;
          this.cache.clear(), this.syncer.reset(), Object.keys(this.triggeredEventMap).forEach(function(t2) {
            e3.triggeredEventMap[t2].clear();
          });
        }, e2;
      })();
      var dt = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          const n2 = new e2(), o2 = this.s;
          if (o2) {
            const e3 = 1 & o2 ? t2 : r2;
            if (e3) {
              try {
                ut(n2, 1, e3(this.v));
              } catch (e4) {
                ut(n2, 2, e4);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              const o3 = e3.v;
              1 & e3.s ? ut(n2, 1, t2 ? t2(o3) : o3) : r2 ? ut(n2, 1, r2(o3)) : ut(n2, 2, o3);
            } catch (e4) {
              ut(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      var pt = function(e2) {
        var t2 = this, r2 = this;
        this.instance = void 0, this.cachedFriendIDs = [], this.clear = function() {
          r2.cachedFriendIDs = [];
        }, this.getFullFriendsIDs = function(e3) {
          try {
            return Promise.resolve(t2.instance.sendHttpRequest({ reqFuncName: C.GetFullFriendUserIDs, data: { idHash: 0, userID: t2.instance.userID }, operationID: e3 })).then(function(e4) {
              var r3 = e4.userIDs;
              return t2.cachedFriendIDs = null != r3 ? r3 : [], null != r3 ? r3 : [];
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.isFriend = function(e3) {
          return r2.cachedFriendIDs.includes(e3);
        }, this.addNewFriend = function(e3) {
          r2.cachedFriendIDs.push(e3);
        }, this.deleteFriend = function(e3) {
          r2.cachedFriendIDs = r2.cachedFriendIDs.filter(function(t3) {
            return t3 !== e3;
          });
        }, this.instance = e2;
      };
      var gt = function(e2) {
        var t2 = this, r2 = this;
        this.instance = void 0, this.syncedFriendsVersion = 0, this.syncedFriendsVersionID = "", this.reset = function() {
          r2.syncedFriendsVersion = 0, r2.syncedFriendsVersionID = "";
        }, this.syncFriendVersion = function(e3) {
          try {
            return Promise.resolve(t2.instance.sendHttpRequest({ reqFuncName: C.GetFriendVersion, data: { userID: t2.instance.userID, version: t2.syncedFriendsVersion, versionID: t2.syncedFriendsVersionID }, operationID: e3 })).then(function(r3) {
              t2.syncedFriendsVersionID && t2.compareVersionAndTrigger(r3, e3), t2.syncedFriendsVersion = r3.version, t2.syncedFriendsVersionID = r3.versionID;
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.compareVersionAndTrigger = function(e3, t3) {
          var n2 = e3.insert, o2 = e3.update, i2 = e3.delete;
          (null != n2 ? n2 : []).map(function(e4) {
            var n3 = He(e4);
            r2.instance.relationTrigger.cache.addNewFriend(n3.userID), r2.instance.triggerEvent({ operationID: t3, event: exports.CbEvents.OnFriendAdded, data: n3 });
          }), (null != o2 ? o2 : []).map(function(e4) {
            var n3 = He(e4);
            r2.instance.triggerEvent({ operationID: t3, event: exports.CbEvents.OnFriendInfoChanged, data: n3 });
            var o3 = [r2.instance.userID, null == n3 ? void 0 : n3.userID].sort(), i3 = "si_" + o3[0] + "_" + o3[1], s2 = r2.instance.messageTrigger.cache.getCachedConversation(i3);
            !s2 || s2.showName === (n3.remark || n3.nickname) && s2.faceURL === n3.faceURL || r2.instance.messageTrigger.getOneConversationAndTryChange(i3, t3, { showName: n3.remark || n3.nickname, faceURL: n3.faceURL });
          }), (null != i2 ? i2 : []).map(function(e4) {
            r2.instance.triggerEvent({ operationID: t3, event: exports.CbEvents.OnFriendDeleted, data: { userID: e4 } });
          });
        }, this.instance = e2;
      };
      function lt(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof vt) {
            if (!r2.s) return void (r2.o = lt.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(lt.bind(null, e2, t2), lt.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var ft = function(e2) {
        var t2, r2 = this, n2 = this, o2 = this, i2 = this;
        this.instance = void 0, this.cache = void 0, this.syncer = void 0, this.triggeredEventMap = ((t2 = {})[exports.CbEvents.OnFriendApplicationAdded] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnFriendApplicationAccepted] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnFriendApplicationRejected] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnFriendAdded] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnFriendDeleted] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnFriendInfoChanged] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnBlackAdded] = /* @__PURE__ */ new Map(), t2[exports.CbEvents.OnBlackDeleted] = /* @__PURE__ */ new Map(), t2), this.sync = function(e3) {
          var t3 = [i2.syncer.syncFriendVersion(e3), i2.cache.getFullFriendsIDs(e3)];
          return Promise.all(t3);
        }, this.reset = function() {
          i2.cache.clear(), i2.syncer.reset(), Object.keys(i2.triggeredEventMap).forEach(function(e3) {
            i2.triggeredEventMap[e3].clear();
          });
        }, this.setTriggeredEventMap = function(e3, t3) {
          i2.triggeredEventMap[e3].set(t3, true);
        }, this.checkShouldTrigger = function(e3, t3) {
          return !e3 || !i2.triggeredEventMap[e3].has(t3) || (i2.triggeredEventMap[e3].delete(t3), false);
        }, this.getDesignatedFriendApplicationAndTrigger = function(e3, t3, n3, o3) {
          void 0 === o3 && (o3 = false);
          try {
            return !o3 && r2.triggeredEventMap[e3].has(n3) ? (r2.triggeredEventMap[e3].delete(n3), Promise.resolve()) : Promise.resolve(r2.instance.sendHttpRequest({ reqFuncName: C.GetDesignatedFriendsApplication, data: { fromUserID: t3.fromUserID, toUserID: t3.toUserID }, operationID: n3 })).then(function(t4) {
              var o4 = t4.friendRequests;
              o4 && r2.instance.triggerEvent({ event: e3, operationID: n3, data: o4[0] });
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getDesignatedBlackUserAndTrigger = function(e3, t3, r3, o3) {
          void 0 === o3 && (o3 = false);
          try {
            return !o3 && n2.triggeredEventMap[e3].has(r3) ? (n2.triggeredEventMap[e3].delete(r3), Promise.resolve()) : Promise.resolve(n2.instance.sendHttpRequest({ reqFuncName: C.GetDesignatedBlackUser, data: { ownerUserID: n2.instance.userID, userIDList: [t3] }, operationID: r3 })).then(function(t4) {
              var o4 = t4.blacks;
              o4 && n2.instance.triggerEvent({ event: e3, data: o4.map(Je)[0], operationID: r3 });
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.parseMessageAndTrigger = function(e3, t3) {
          try {
            return Promise.resolve((function(e4, t4) {
              var r3, n3 = -1;
              e: {
                for (var o3 = 0; o3 < t4.length; o3++) {
                  var i3 = t4[o3][0];
                  if (i3) {
                    var s2 = i3();
                    if (s2 && s2.then) break e;
                    if (s2 === e4) {
                      n3 = o3;
                      break;
                    }
                  } else n3 = o3;
                }
                if (-1 !== n3) {
                  do {
                    for (var a2 = t4[n3][1]; !a2; ) n3++, a2 = t4[n3][1];
                    var u2 = a2();
                    if (u2 && u2.then) {
                      r3 = true;
                      break e;
                    }
                    var c2 = t4[n3][2];
                    n3++;
                  } while (c2 && !c2());
                  return u2;
                }
              }
              var d2 = new vt(), p2 = lt.bind(null, d2, 2);
              return (r3 ? u2.then(g2) : s2.then(function r4(s3) {
                for (; ; ) {
                  if (s3 === e4) {
                    n3 = o3;
                    break;
                  }
                  if (++o3 === t4.length) {
                    if (-1 !== n3) break;
                    return void lt(d2, 1, u3);
                  }
                  if (i3 = t4[o3][0]) {
                    if ((s3 = i3()) && s3.then) return void s3.then(r4).then(void 0, p2);
                  } else n3 = o3;
                }
                do {
                  for (var a3 = t4[n3][1]; !a3; ) n3++, a3 = t4[n3][1];
                  var u3 = a3();
                  if (u3 && u3.then) return void u3.then(g2).then(void 0, p2);
                  var c3 = t4[n3][2];
                  n3++;
                } while (c3 && !c3());
                lt(d2, 1, u3);
              })).then(void 0, p2), d2;
              function g2(e5) {
                for (; ; ) {
                  var r4 = t4[n3][2];
                  if (!r4 || r4()) break;
                  n3++;
                  for (var o4 = t4[n3][1]; !o4; ) n3++, o4 = t4[n3][1];
                  if ((e5 = o4()) && e5.then) return void e5.then(g2).then(void 0, p2);
                }
                lt(d2, 1, e5);
              }
            })(e3.contentType, [[function() {
              return exports.NotificationType.FriendApplicationNotification;
            }, function() {
              var r3 = Ve(e3.content);
              return s.default.debug("Recv FriendApplicationNotification with opid: ", t3, "tips: ", r3), Promise.resolve(o2.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationAdded, r3.fromToUserID, t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.FriendApplicationApprovedNotification;
            }, function() {
              var r3 = Ve(e3.content);
              return s.default.debug("Recv FriendApplicationApprovedNotification with opid: ", t3, "tips: ", r3), Promise.resolve(o2.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationAccepted, r3.fromToUserID, t3)).then(function() {
                if (o2.checkShouldTrigger(exports.CbEvents.OnFriendAdded, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
                });
              });
            }], [function() {
              return exports.NotificationType.FriendApplicationRejectedNotification;
            }, function() {
              var r3 = Ve(e3.content);
              return s.default.debug("Recv FriendApplicationRejectedNotification with opid: ", t3, "tips: ", r3), Promise.resolve(o2.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationRejected, r3.fromToUserID, t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.FriendAddedNotification;
            }, function() {
              var r3 = Ve(e3.content);
              if (s.default.debug("Recv FriendAddedNotification with opid: ", t3, "tips: ", r3), o2.checkShouldTrigger(exports.CbEvents.OnFriendAdded, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
                var e4;
                o2.cache.addNewFriend(null == (e4 = r3.friend) || null == (e4 = e4.friendUser) ? void 0 : e4.userID);
              });
            }], [function() {
              return exports.NotificationType.FriendDeletedNotification;
            }, function() {
              var r3 = Ve(e3.content);
              if (s.default.debug("Recv FriendDeletedNotification with opid: ", t3, "tips: ", r3), o2.checkShouldTrigger(exports.CbEvents.OnFriendDeleted, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
                var e4, t4, n3, i3 = (null == (e4 = r3.fromToUserID) ? void 0 : e4.fromUserID) === o2.instance.userID ? null == (t4 = r3.fromToUserID) ? void 0 : t4.toUserID : null == (n3 = r3.fromToUserID) ? void 0 : n3.fromUserID;
                i3 && o2.cache.deleteFriend(i3);
              });
            }], [function() {
              return exports.NotificationType.FriendRemarkSetNotification;
            }, function() {
              var r3 = Ve(e3.content);
              if (s.default.debug("Recv FriendRemarkSetNotification with opid: ", t3, "tips: ", r3), o2.checkShouldTrigger(exports.CbEvents.OnFriendInfoChanged, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.FriendInfoUpdatedNotification;
            }, function() {
              var r3 = Ve(e3.content);
              if (s.default.debug("Recv FriendInfoUpdatedNotification with opid: ", t3, "tips: ", r3), o2.checkShouldTrigger(exports.CbEvents.OnFriendInfoChanged, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
              });
            }], [function() {
              return exports.NotificationType.BlackAddedNotification;
            }, function() {
              var r3, n3 = Ve(e3.content);
              return s.default.debug("Recv BlackAddedNotification with opid: ", t3, "tips: ", n3), void o2.getDesignatedBlackUserAndTrigger(exports.CbEvents.OnBlackAdded, null == (r3 = n3.fromToUserID) ? void 0 : r3.toUserID, t3);
            }], [function() {
              return exports.NotificationType.BlackDeletedNotification;
            }, function() {
              var r3, n3 = Ve(e3.content);
              return s.default.debug("Recv BlackDeletedNotification with opid: ", t3, "tips: ", n3), void o2.instance.triggerEvent({ event: exports.CbEvents.OnBlackDeleted, data: { userID: null == (r3 = n3.fromToUserID) ? void 0 : r3.toUserID }, operationID: t3 });
            }], [function() {
              return exports.NotificationType.FriendsInfoUpdateNotification;
            }, function() {
              var r3 = Ve(e3.content);
              if (s.default.debug("Recv FriendsInfoUpdateNotification with opid: ", t3, "tips: ", r3), o2.checkShouldTrigger(exports.CbEvents.OnFriendInfoChanged, t3)) return Promise.resolve(o2.syncer.syncFriendVersion(t3)).then(function() {
              });
            }], []]));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2, this.cache = new pt(e2), this.syncer = new gt(e2);
      };
      var vt = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          const n2 = new e2(), o2 = this.s;
          if (o2) {
            const e3 = 1 & o2 ? t2 : r2;
            if (e3) {
              try {
                lt(n2, 1, e3(this.v));
              } catch (e4) {
                lt(n2, 2, e4);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              const o3 = e3.v;
              1 & e3.s ? lt(n2, 1, t2 ? t2(o3) : o3) : r2 ? lt(n2, 1, r2(o3)) : lt(n2, 2, o3);
            } catch (e4) {
              lt(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      var ht = function(e2) {
        var t2 = this;
        this.instance = void 0, this.parseMessageAndTrigger = function(e3, r2) {
          try {
            var n2 = Ve(e3.content);
            return s.default.debug("Recv BussinessMessage with opid: ", r2, "tips: ", n2), t2.instance.triggerEvent({ event: exports.CbEvents.OnRecvCustomBusinessMessage, data: n2, operationID: r2 }), Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2;
      };
      var mt = function(e2) {
        var t2 = this, r2 = this, n2 = this;
        this.instance = void 0, this.cachedLoginUserInfo = null, this.clear = function() {
          n2.cachedLoginUserInfo = null;
        }, this.getSelfUserInfo = function() {
          return n2.cachedLoginUserInfo;
        }, this.syncLoginUserInfoAndTrigger = function(e3) {
          try {
            return Promise.resolve(t2.instance.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSelfUserInfo, data: { userIDs: [t2.instance.userID] }, operationID: e3 })).then(function(e4) {
              var r3 = e4.usersInfo;
              t2.cachedLoginUserInfo && JSON.stringify(t2.cachedLoginUserInfo) !== JSON.stringify(r3[0]) && t2.instance.triggerEvent({ event: exports.CbEvents.OnSelfInfoUpdated, data: r3[0] }), t2.cachedLoginUserInfo = r3[0];
            });
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.udpateCachedLoginUserInfoAndTrigger = function(e3, t3) {
          try {
            return r2.cachedLoginUserInfo ? (r2.cachedLoginUserInfo = l({}, r2.cachedLoginUserInfo, e3), r2.instance.triggerEvent({ event: exports.CbEvents.OnSelfInfoUpdated, data: r2.cachedLoginUserInfo, operationID: t3 }), Promise.resolve()) : Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2;
      };
      var It = function(e2) {
        var t2 = this, r2 = this, o2 = this;
        this.ctx = void 0, this.state = /* @__PURE__ */ new Map(), this.updateSubs = function(e3) {
          var t3 = e3.sub, o3 = e3.unSub, i2 = e3.operationID;
          try {
            return 0 !== r2.state.size || t3 ? Promise.resolve(r2.ctx.sendReqWaitResp({ reqIdentifier: exports.ReqIdentifier.WsSubUserOnlineStatus, operationID: i2, data: n.PbCoder.SubUserOnlineStatus.encode({ subscribeUserID: null != t3 ? t3 : Array.from(r2.state.keys()), unsubscribeUserID: null != o3 ? o3 : [] }).finish() })).then(function(e4) {
              var t4 = e4.subscribers;
              (null != t4 ? t4 : []).forEach(function(e5) {
                return r2.state.set(e5.userID, e5.onlinePlatformIDs);
              }), null != o3 && o3.length && o3.forEach(function(e5) {
                return r2.state.delete(e5);
              });
            }) : Promise.resolve();
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getUserOnlineState = function(e3, t3) {
          try {
            var r3 = function() {
              return e3.map(function(e4) {
                var t4, r4;
                return { userID: e4, status: null != (t4 = o2.state.get(e4)) && t4.length ? 1 : 0, platformIDs: null != (r4 = o2.state.get(e4)) ? r4 : [] };
              });
            }, n2 = e3.filter(function(e4) {
              return !o2.state.has(e4);
            }), i2 = (function() {
              if (n2.length) return Promise.resolve(o2.updateSubs({ operationID: t3, sub: n2 })).then(function() {
              });
            })();
            return Promise.resolve(i2 && i2.then ? i2.then(r3) : r3());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.getAllSubUsersOnlineState = function() {
          return Array.from(t2.state.keys()).map(function(e3) {
            var r3, n2;
            return { userID: e3, status: null != (r3 = t2.state.get(e3)) && r3.length ? 1 : 0, platformIDs: null != (n2 = t2.state.get(e3)) ? n2 : [] };
          });
        }, this.userOnlineStateChange = function(e3) {
          var r3 = e3.subscribers;
          (null != r3 ? r3 : []).forEach(function(e4) {
            var r4;
            e4.onlinePlatformIDs.length ? t2.state.set(e4.userID, e4.onlinePlatformIDs) : t2.state.delete(e4.userID), t2.ctx.triggerEvent({ event: exports.CbEvents.OnUserStatusChanged, data: { userID: e4.userID, status: e4.onlinePlatformIDs.length ? 1 : 0, platformIDs: null != (r4 = e4.onlinePlatformIDs) ? r4 : [] } });
          });
        }, this.ctx = e2;
      };
      function Mt(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof Dt) {
            if (!r2.s) return void (r2.o = Mt.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(Mt.bind(null, e2, t2), Mt.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var yt = function(e2) {
        var t2 = this, r2 = this;
        this.instance = void 0, this.cache = void 0, this.onlineSub = void 0, this.triggeredEventMap = /* @__PURE__ */ new Map(), this.sync = function(e3) {
          return Promise.all([r2.cache.syncLoginUserInfoAndTrigger(e3), r2.onlineSub.updateSubs({ operationID: e3 })]);
        }, this.reset = function() {
          r2.cache.clear(), r2.triggeredEventMap.clear();
        }, this.setTriggeredEventMap = function(e3) {
          r2.triggeredEventMap.set(e3, true);
        }, this.checkConversationUpdate = function(e3) {
          var t3 = [r2.instance.userID, e3.userID].sort(), n2 = "si_" + t3[0] + "_" + t3[1], o2 = r2.instance.messageTrigger.cache.getCachedConversation(n2);
          !o2 || o2.showName === e3.nickname && o2.faceURL === e3.faceURL || r2.instance.messageTrigger.getOneConversationAndTryChange(n2, "", { showName: e3.nickname, faceURL: e3.faceURL });
        }, this.parseMessageAndTrigger = function(e3, r3) {
          try {
            return Promise.resolve((function(e4, t3) {
              var r4, n2 = -1;
              e: {
                for (var o2 = 0; o2 < t3.length; o2++) {
                  var i2 = t3[o2][0];
                  if (i2) {
                    var s2 = i2();
                    if (s2 && s2.then) break e;
                    if (s2 === e4) {
                      n2 = o2;
                      break;
                    }
                  } else n2 = o2;
                }
                if (-1 !== n2) {
                  do {
                    for (var a2 = t3[n2][1]; !a2; ) n2++, a2 = t3[n2][1];
                    var u2 = a2();
                    if (u2 && u2.then) {
                      r4 = true;
                      break e;
                    }
                    var c2 = t3[n2][2];
                    n2++;
                  } while (c2 && !c2());
                  return u2;
                }
              }
              var d2 = new Dt(), p2 = Mt.bind(null, d2, 2);
              return (r4 ? u2.then(g2) : s2.then(function r5(s3) {
                for (; ; ) {
                  if (s3 === e4) {
                    n2 = o2;
                    break;
                  }
                  if (++o2 === t3.length) {
                    if (-1 !== n2) break;
                    return void Mt(d2, 1, u3);
                  }
                  if (i2 = t3[o2][0]) {
                    if ((s3 = i2()) && s3.then) return void s3.then(r5).then(void 0, p2);
                  } else n2 = o2;
                }
                do {
                  for (var a3 = t3[n2][1]; !a3; ) n2++, a3 = t3[n2][1];
                  var u3 = a3();
                  if (u3 && u3.then) return void u3.then(g2).then(void 0, p2);
                  var c3 = t3[n2][2];
                  n2++;
                } while (c3 && !c3());
                Mt(d2, 1, u3);
              })).then(void 0, p2), d2;
              function g2(e5) {
                for (; ; ) {
                  var r5 = t3[n2][2];
                  if (!r5 || r5()) break;
                  n2++;
                  for (var o3 = t3[n2][1]; !o3; ) n2++, o3 = t3[n2][1];
                  if ((e5 = o3()) && e5.then) return void e5.then(g2).then(void 0, p2);
                }
                Mt(d2, 1, e5);
              }
            })(e3.contentType, [[function() {
              return exports.NotificationType.UserInfoUpdatedNotification;
            }, function() {
              var n2 = Ve(e3.content);
              if (s.default.debug("Recv UserInfoUpdatedNotification with opid: ", r3, "tips: ", n2), !t2.triggeredEventMap.get(r3)) {
                var o2 = (function() {
                  if (n2.userID === t2.instance.userID) return Promise.resolve(t2.cache.syncLoginUserInfoAndTrigger(r3)).then(function() {
                  });
                })();
                return o2 && o2.then ? o2.then(function() {
                }) : void 0;
              }
              t2.triggeredEventMap.delete(r3);
            }]]));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, this.instance = e2, this.cache = new mt(e2), this.onlineSub = new It(e2);
      };
      var Dt = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          const n2 = new e2(), o2 = this.s;
          if (o2) {
            const e3 = 1 & o2 ? t2 : r2;
            if (e3) {
              try {
                Mt(n2, 1, e3(this.v));
              } catch (e4) {
                Mt(n2, 2, e4);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              const o3 = e3.v;
              1 & e3.s ? Mt(n2, 1, t2 ? t2(o3) : o3) : r2 ? Mt(n2, 1, r2(o3)) : Mt(n2, 2, o3);
            } catch (e4) {
              Mt(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      function Ct(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof St) {
            if (!r2.s) return void (r2.o = Ct.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(Ct.bind(null, e2, t2), Ct.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var St = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          var n2 = new e2(), o2 = this.s;
          if (o2) {
            var i2 = 1 & o2 ? t2 : r2;
            if (i2) {
              try {
                Ct(n2, 1, i2(this.v));
              } catch (e3) {
                Ct(n2, 2, e3);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              var o3 = e3.v;
              1 & e3.s ? Ct(n2, 1, t2 ? t2(o3) : o3) : r2 ? Ct(n2, 1, r2(o3)) : Ct(n2, 2, o3);
            } catch (e4) {
              Ct(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      function Tt(e2) {
        return e2 instanceof St && 1 & e2.s;
      }
      var xt;
      var bt = /* @__PURE__ */ (function() {
        function e2() {
          this.queue = [], this.pending = false;
        }
        var t2 = e2.prototype;
        return t2.enqueue = function(e3) {
          try {
            var t3 = this;
            return Promise.resolve(new Promise(function(r2, n2) {
              t3.queue.push([function() {
                return e3().then(r2).catch(n2);
              }, n2]), t3.pending || (t3.pending = true, t3.dequeue());
            }));
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, t2.cancelTasks = function() {
          this.queue.forEach(function(e3) {
            return (0, e3[1])(new le(exports.ErrorCode.NetworkError, "network error, ws not connected"));
          }), this.queue = [];
        }, t2.dequeue = function() {
          try {
            var e3 = function() {
              t3.pending = false;
            }, t3 = this, r2 = (function(e4, t4, r3) {
              for (var n2; ; ) {
                var o2 = e4();
                if (Tt(o2) && (o2 = o2.v), !o2) return i2;
                if (o2.then) {
                  n2 = 0;
                  break;
                }
                var i2 = r3();
                if (i2 && i2.then) {
                  if (!Tt(i2)) {
                    n2 = 1;
                    break;
                  }
                  i2 = i2.s;
                }
              }
              var s2 = new St(), a2 = Ct.bind(null, s2, 2);
              return (0 === n2 ? o2.then(c2) : 1 === n2 ? i2.then(u2) : (void 0).then(function() {
                (o2 = e4()) ? o2.then ? o2.then(c2).then(void 0, a2) : c2(o2) : Ct(s2, 1, i2);
              })).then(void 0, a2), s2;
              function u2(t5) {
                i2 = t5;
                do {
                  if (!(o2 = e4()) || Tt(o2) && !o2.v) return void Ct(s2, 1, i2);
                  if (o2.then) return void o2.then(c2).then(void 0, a2);
                  Tt(i2 = r3()) && (i2 = i2.v);
                } while (!i2 || !i2.then);
                i2.then(u2).then(void 0, a2);
              }
              function c2(e5) {
                e5 ? (i2 = r3()) && i2.then ? i2.then(u2).then(void 0, a2) : u2(i2) : Ct(s2, 1, i2);
              }
            })(function() {
              return t3.queue.length > 0;
            }, 0, function() {
              var e4 = t3.queue.shift()[0], r3 = (function(t4, r4) {
                try {
                  var n2 = Promise.resolve(e4()).then(function() {
                  });
                } catch (e5) {
                  return r4(e5);
                }
                return n2 && n2.then ? n2.then(void 0, r4) : n2;
              })(0, function(e5) {
                s.default.error("Error executing task:", e5);
              });
              if (r3 && r3.then) return r3.then(function() {
              });
            });
            return Promise.resolve(r2 && r2.then ? r2.then(e3) : e3());
          } catch (e4) {
            return Promise.reject(e4);
          }
        }, e2;
      })();
      function At(e2, t2) {
        try {
          var r2 = e2();
        } catch (e3) {
          return t2(e3);
        }
        return r2 && r2.then ? r2.then(void 0, t2) : r2;
      }
      var Rt = ((xt = {})[exports.MessageType.TextMessage] = "textElem", xt[exports.MessageType.AtTextMessage] = "atTextElem", xt[exports.MessageType.LocationMessage] = "locationElem", xt[exports.MessageType.CustomMessage] = "customElem", xt[exports.MessageType.MergeMessage] = "mergeElem", xt[exports.MessageType.QuoteMessage] = "quoteElem", xt[exports.MessageType.CardMessage] = "cardElem", xt[exports.MessageType.FaceMessage] = "faceElem", xt[exports.MessageType.PictureMessage] = "pictureElem", xt[exports.MessageType.VoiceMessage] = "soundElem", xt[exports.MessageType.VideoMessage] = "videoElem", xt[exports.MessageType.FileMessage] = "fileElem", xt);
      var Pt = [exports.MessageType.PictureMessage, exports.MessageType.VoiceMessage, exports.MessageType.VideoMessage, exports.MessageType.FileMessage];
      var Gt = /* @__PURE__ */ (function(e2) {
        function t2(t3, r2) {
          var n2;
          return (n2 = e2.call(this, r2) || this).status = void 0, n2.name = "HttpError", n2.status = t3, n2;
        }
        return v(t2, e2), t2;
      })(/* @__PURE__ */ M(Error));
      function Nt(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof qt) {
            if (!r2.s) return void (r2.o = Nt.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(Nt.bind(null, e2, t2), Nt.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var qt = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          var n2 = new e2(), o2 = this.s;
          if (o2) {
            var i2 = 1 & o2 ? t2 : r2;
            if (i2) {
              try {
                Nt(n2, 1, i2(this.v));
              } catch (e3) {
                Nt(n2, 2, e3);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              var o3 = e3.v;
              1 & e3.s ? Nt(n2, 1, t2 ? t2(o3) : o3) : r2 ? Nt(n2, 1, r2(o3)) : Nt(n2, 2, o3);
            } catch (e4) {
              Nt(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      function Et(e2) {
        return e2 instanceof qt && 1 & e2.s;
      }
      function wt(e2, t2) {
        try {
          var r2 = e2();
        } catch (e3) {
          return t2(e3);
        }
        return r2 && r2.then ? r2.then(void 0, t2) : r2;
      }
      var Ut = [C.GetActiveConversations, C.GetDesignatedConversation];
      function Ot(e2, t2, r2) {
        if (!e2.s) {
          if (r2 instanceof kt) {
            if (!r2.s) return void (r2.o = Ot.bind(null, e2, t2));
            1 & t2 && (t2 = r2.s), r2 = r2.v;
          }
          if (r2 && r2.then) return void r2.then(Ot.bind(null, e2, t2), Ot.bind(null, e2, 2));
          e2.s = t2, e2.v = r2;
          var n2 = e2.o;
          n2 && n2(e2);
        }
      }
      var Ft = /* @__PURE__ */ (function(e2) {
        function t2() {
          var t3, o2;
          return (t3 = e2.call(this) || this).userID = void 0, t3.platform = void 0, t3.token = void 0, t3.apiAddr = void 0, t3.loginStatus = exports.LoginStatus.Logout, t3.isReconnected = false, t3.connectState = "disconnected", t3.wsManager = void 0, t3.messageTrigger = void 0, t3.userTrigger = void 0, t3.groupTrigger = void 0, t3.relationTrigger = void 0, t3.businessTrigger = void 0, t3.requestMap = /* @__PURE__ */ new Map(), t3.rejectAllPendingRequests = function(e3) {
            t3.requestMap.size && (t3.requestMap.forEach(function(t4) {
              var r2 = t4.reject;
              try {
                r2(e3);
              } catch (e4) {
              }
            }), t3.requestMap.clear());
          }, t3.generateHttpHeader = function(e3, r2) {
            var n2 = { "Content-Type": "application/json", token: t3.token, operationID: r2, reqFuncName: e3 };
            return Ut.includes(e3) && (n2["Content-Type"] = "application/x-protobuf"), n2;
          }, t3.sendHttpRequest = function(e3) {
            try {
              var r2;
              return Promise.resolve((function(e4, t4) {
                void 0 === t4 && (t4 = {});
                var r3 = e4.url, n2 = e4.data, o3 = e4.headers, i2 = e4.platform, s2 = e4.method, a2 = void 0 === s2 ? "POST" : s2, u2 = t4.retries, c2 = void 0 === u2 ? 3 : u2, d2 = t4.baseDelayMs, p2 = void 0 === d2 ? 300 : d2, g2 = t4.maxDelayMs, f2 = void 0 === g2 ? 3e3 : g2;
                return (function(t5) {
                  try {
                    var s3 = 0;
                    return Promise.resolve((function(e5, t6, r4) {
                      for (var n3; ; ) {
                        var o4 = e5();
                        if (Et(o4) && (o4 = o4.v), !o4) return i3;
                        if (o4.then) {
                          n3 = 0;
                          break;
                        }
                        var i3 = r4();
                        if (i3 && i3.then) {
                          if (!Et(i3)) {
                            n3 = 1;
                            break;
                          }
                          i3 = i3.s;
                        }
                      }
                      var s4 = new qt(), a3 = Nt.bind(null, s4, 2);
                      return (0 === n3 ? o4.then(c3) : 1 === n3 ? i3.then(u3) : (void 0).then(function() {
                        (o4 = e5()) ? o4.then ? o4.then(c3).then(void 0, a3) : c3(o4) : Nt(s4, 1, i3);
                      })).then(void 0, a3), s4;
                      function u3(t7) {
                        i3 = t7;
                        do {
                          if (!(o4 = e5()) || Et(o4) && !o4.v) return void Nt(s4, 1, i3);
                          if (o4.then) return void o4.then(c3).then(void 0, a3);
                          Et(i3 = r4()) && (i3 = i3.v);
                        } while (!i3 || !i3.then);
                        i3.then(u3).then(void 0, a3);
                      }
                      function c3(e6) {
                        e6 ? (i3 = r4()) && i3.then ? i3.then(u3).then(void 0, a3) : u3(i3) : Nt(s4, 1, i3);
                      }
                    })(function() {
                      return !t5;
                    }, 0, function() {
                      return (function(s4, u3) {
                        try {
                          var c3 = Promise.resolve("web" === i2 ? (function(e5) {
                            var t6 = e5.url, r4 = e5.data, n3 = e5.headers, o4 = e5.method, i3 = void 0 === o4 ? "POST" : o4;
                            try {
                              return Promise.resolve(fetch(t6, { method: i3, headers: l({}, n3), body: r4 instanceof Uint8Array ? r4 : JSON.stringify(r4) }).then(function(e6) {
                                if (e6.ok) return e6.json();
                                throw new Gt(e6.status, e6.statusText || "HTTP_" + e6.status);
                              }).then(function(e6) {
                                if (0 !== e6.errCode) throw new Error(e6.errMsg);
                                return e6.data;
                              }));
                            } catch (e6) {
                              return Promise.reject(e6);
                            }
                          })(e4) : new Promise(function(e5, t6) {
                            var s5 = (function(e6) {
                              return "uni" === e6 ? uni.request.bind(uni) : "wx" === e6 ? wx.request.bind(wx) : "my" === e6 ? (my.request || my.httpRequest).bind(my) : null;
                            })(i2);
                            s5 ? s5({ url: r3, data: n2 instanceof Uint8Array ? Uint8Array.from(n2).buffer : n2, method: a2, header: l({ "Content-Type": "application/json" }, o3), success: function(r4) {
                              200 === r4.statusCode && 0 === r4.data.errCode ? e5(r4.data.data) : t6({ statusCode: r4.statusCode, data: r4.data });
                            }, fail: function(e6) {
                              t6(e6);
                            } }) : t6(new Error("Request is not supported"));
                          })).then(function(e5) {
                            return t5 = 1, e5;
                          });
                        } catch (e5) {
                          return u3(e5);
                        }
                        return c3 && c3.then ? c3.then(void 0, u3) : c3;
                      })(0, function(e5) {
                        if (++s3 > c2 || !(function(e6) {
                          if (!e6) return false;
                          if (e6 instanceof Gt) return e6.status >= 500;
                          if ("object" == typeof e6 && "number" == typeof e6.statusCode) return e6.statusCode >= 500;
                          var t7 = String((null == e6 ? void 0 : e6.message) || e6 || "").toLowerCase();
                          return !!(t7.includes("network") || t7.includes("timeout") || t7.includes("failed to fetch") || t7.includes("request:fail"));
                        })(e5)) throw e5;
                        var t6, r4 = Math.min(p2 * Math.pow(2, s3 - 1), f2), n3 = Math.floor(150 * Math.random());
                        return Promise.resolve((t6 = r4 + n3, new Promise(function(e6) {
                          return setTimeout(e6, t6);
                        }))).then(function() {
                        });
                      });
                    }));
                  } catch (e5) {
                    return Promise.reject(e5);
                  }
                })();
              })({ url: "" + t3.apiAddr + (e3.replaceURL || F[e3.reqFuncName]), data: e3.data, headers: t3.generateHttpHeader(e3.reqFuncName, e3.operationID), platform: (null == (r2 = t3.wsManager) ? void 0 : r2.platformNamespace) || "web" }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, t3.handleWsConnected = function(e3, r2) {
            try {
              var n2 = (function() {
                if (0 === e3.errCode) {
                  var n3 = "reconnecting" === t3.connectState;
                  t3.connectState = "connected", t3.loginStatus = exports.LoginStatus.Logged, t3.triggerEvent({ event: exports.CbEvents.OnConnectSuccess }), t3.triggerEvent({ event: exports.CbEvents.OnSyncServerStart });
                  var o3 = [t3.messageTrigger.sync(r2, { skipGetActiveConversationsFromServer: n3 }), t3.relationTrigger.sync(r2), t3.groupTrigger.sync(r2), t3.userTrigger.sync(r2)], i2 = wt(function() {
                    return Promise.resolve(Promise.all(o3)).then(function() {
                      t3.triggerEvent({ event: exports.CbEvents.OnSyncServerFinish });
                    });
                  }, function(e4) {
                    s.default.error(e4), t3.triggerEvent({ event: exports.CbEvents.OnSyncServerFailed, errCode: e4.errCode || exports.ErrorCode.SdkInternalError, errMsg: e4.message || "Internal Error" });
                  });
                  if (i2 && i2.then) return i2.then(function() {
                  });
                } else {
                  t3.triggerEvent({ event: exports.CbEvents.OnConnectFailed, errCode: e3.errCode, errMsg: e3.errMsg, operationID: r2 });
                  var a2 = ne[e3.errCode];
                  a2 && t3.triggerEvent({ event: a2, errCode: e3.errCode, errMsg: e3.errMsg, operationID: r2 }), t3.connectState = "disconnected", t3.loginStatus = exports.LoginStatus.Logout, t3.reset();
                }
              })();
              return Promise.resolve(n2 && n2.then ? n2.then(function() {
              }) : void 0);
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, t3.handleMessage = function(e3, r2) {
            try {
              var n2 = (function() {
                if ("string" != typeof e3) {
                  var n3 = function() {
                    var r3, n4, o4 = (r3 = e3, n4 = new DataView(r3), Ne.getString(n4, 0, r3.byteLength, "UTF-8")), i3 = JSON.parse(o4);
                    t3.handleGeneralWsResp(i3);
                  }, o3 = (function() {
                    if (!(e3 instanceof ArrayBuffer)) return Promise.resolve(e3.arrayBuffer()).then(function(t4) {
                      e3 = t4;
                    });
                  })();
                  return o3 && o3.then ? o3.then(n3) : n3();
                }
                var i2 = JSON.parse(e3);
                t3.handleWsConnected(i2, r2);
              })();
              return Promise.resolve(n2 && n2.then ? n2.then(function() {
              }) : void 0);
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, t3.handleGeneralWsResp = function(e3) {
            var r2 = de(e3.data, e3.reqIdentifier);
            if (e3.reqIdentifier === exports.ReqIdentifier.PushMsg && r2) return t3.messageTrigger.triggerConversation(r2.msgs, e3.operationID), void t3.messageTrigger.triggerNotification(r2.notificationMsgs, e3.operationID);
            if (e3.reqIdentifier !== exports.ReqIdentifier.WsSubUserOnlineStatus || e3.msgIncr || t3.userTrigger.onlineSub.userOnlineStateChange(r2), e3.reqIdentifier === exports.ReqIdentifier.KickOnlineMsg) return t3.triggerEvent({ event: exports.CbEvents.OnKickedOffline, operationID: e3.operationID }), void t3.reset();
            var n2 = t3.requestMap.get(e3.msgIncr);
            n2 && (0 === e3.errCode ? n2.resolve(r2) : n2.reject(new le(e3.errCode, e3.errMsg)), t3.requestMap.delete(e3.msgIncr));
          }, t3.handleReconnecting = function() {
            t3.connectState = "reconnecting", t3.triggerEvent({ event: exports.CbEvents.OnConnecting });
          }, t3.handleReconnectFailed = function() {
            t3.connectState = "disconnected", t3.rejectAllPendingRequests(new le(exports.ErrorCode.NetworkError, "network error, ws reconnect failed")), t3.triggerEvent({ event: exports.CbEvents.OnConnectFailed, errCode: exports.ErrorCode.NetworkError, errMsg: "network error" }), t3.cancelMessageTasks();
          }, t3.handleReconnectSuccess = function() {
            t3.isReconnected = true;
          }, t3.sendReqWaitResp = function(e3) {
            var n2 = e3.data, o3 = e3.reqIdentifier, i2 = e3.operationID;
            if ("connected" !== t3.connectState) throw new le(exports.ErrorCode.NetworkError, "network error, ws not connected");
            var s2 = oe();
            return new Promise(function(e4, a2) {
              var u2;
              t3.requestMap.set(s2, { resolve: e4, reject: a2 }), null == (u2 = t3.wsManager) || u2.sendMessage({ reqIdentifier: o3, msgIncr: s2, sendID: t3.userID, operationID: i2, data: r.encode(n2.buffer) });
            });
          }, t3.triggerEvent = function(e3) {
            var r2 = e3.event, n2 = e3.data, o3 = void 0 === n2 ? null : n2, i2 = e3.errCode, a2 = void 0 === i2 ? 0 : i2, u2 = e3.errMsg, c2 = void 0 === u2 ? "" : u2, d2 = e3.operationID, p2 = void 0 === d2 ? "" : d2;
            t3.loginStatus !== exports.LoginStatus.Logout && (s.default.debug("%cSDK =>%c [OperationID:" + p2 + "] (event) trigger " + r2 + " with data " + JSON.stringify(o3) + " errCode " + a2 + " errMsg " + c2, "font-size:14px; background:#6F42C1; border-radius:4px; padding-inline:4px;", ""), t3.emit(r2, { event: r2, data: o3, errCode: a2, errMsg: c2, operationID: p2 }));
          }, t3.login = function(e3, r2) {
            try {
              return Promise.resolve(fe(exports.LoginStatus.Logged, exports.RequestApi.Login, r2, function() {
                try {
                  var n2, o3 = e3.userID, i2 = e3.token, a2 = e3.wsAddr, u2 = e3.apiAddr, c2 = e3.platformID;
                  if (t3.wsManager) throw new le(exports.ErrorCode.LoginRepeatError, "login repeat");
                  return s.default.setLevel(null != (n2 = e3.logLevel) ? n2 : exports.LogLevel.Debug), t3.userID = o3, t3.token = i2, t3.apiAddr = u2, t3.platform = c2, t3.wsManager = new Ue(a2, { userID: o3, token: i2, platformID: c2, operationID: r2, background: false, sendResponse: true, sdkType: "js" }, t3.handleMessage, t3.handleReconnectFailed, t3.handleReconnecting, t3.handleReconnectFailed, t3.handleReconnectSuccess), t3.connectState = "connecting", t3.loginStatus = exports.LoginStatus.Logging, t3.triggerEvent({ event: exports.CbEvents.OnConnecting, operationID: r2 }), Promise.resolve(wt(function() {
                    return Promise.resolve(t3.wsManager.connect()).then(function() {
                    });
                  }, function(e4) {
                    throw t3.triggerEvent({ event: exports.CbEvents.OnConnectFailed, errCode: exports.ErrorCode.NetworkError, errMsg: e4.message || "network error", operationID: r2 }), t3.connectState = "disconnected", t3.loginStatus = exports.LoginStatus.Logout, t3.wsManager.close(), new le(exports.ErrorCode.NetworkError, e4.message || "network error");
                  }));
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, t3.getLoginStatus = function(e3) {
            return fe(exports.LoginStatus.Logged, exports.RequestApi.GetLoginStatus, e3, function() {
              try {
                var e4;
                return null == (e4 = t3.wsManager) || e4.sendPing(), Promise.resolve(t3.loginStatus);
              } catch (e5) {
                return Promise.reject(e5);
              }
            });
          }, t3.forceReconnect = function(e3) {
            return fe(t3.loginStatus, exports.RequestApi.ForceReconnect, e3, function() {
              try {
                var e4;
                return null == (e4 = t3.wsManager) || e4.forceReconnect(true), Promise.resolve();
              } catch (e5) {
                return Promise.reject(e5);
              }
            });
          }, t3.logout = function(e3) {
            return fe(t3.loginStatus, exports.RequestApi.Logout, e3, function() {
              try {
                return t3.reset(), Promise.resolve();
              } catch (e4) {
                return Promise.reject(e4);
              }
            });
          }, t3.internalUploadFile = function(e3, r2, n2) {
            return Promise.resolve(wt(function() {
              var o3 = t3.userID + "/" + e3.name, i2 = (function(e4) {
                var t4, r3, n3 = null != (t4 = null == (r3 = e4.split(".").pop()) ? void 0 : r3.toLowerCase()) ? t4 : "";
                return T[n3] || "application/octet-stream";
              })(e3.name), s2 = { operationID: r2, token: t3.token };
              return Promise.resolve((function(e4, t4, r3) {
                return fetch(e4 + "/object/part_size", { method: "POST", headers: l({}, r3), body: JSON.stringify({ size: t4 }) }).then(S);
              })(t3.apiAddr, e3.size, s2)).then(function(r3) {
                var u2 = r3.size;
                function c2() {
                  var r4 = g2.join(","), c3 = new a.default();
                  return c3.append(r4), Promise.resolve((function(e4, t4, r5) {
                    return fetch(e4 + "/object/initiate_multipart_upload", { method: "POST", headers: l({}, r5), body: JSON.stringify(t4) }).then(S);
                  })(t3.apiAddr, { hash: c3.end(), size: e3.size, partSize: u2, maxParts: -1, cause: "", name: o3, contentType: i2 }, s2)).then(function(r5) {
                    var a2 = r5.url, u3 = r5.upload;
                    if (c3.destroy(), a2) return null == n2 || n2(100), { url: a2 };
                    var d3 = u3.sign.parts, f3 = u3.sign.query, v3 = u3.sign.header, h2 = e3.size, m2 = 0;
                    null == n2 || n2(0);
                    for (var I2 = 0, M2 = [], y2 = function() {
                      try {
                        var t4 = jt(function() {
                          return I2 < d3.length;
                        }, void 0, function() {
                          var t5 = I2++;
                          return Promise.resolve((function(t6) {
                            try {
                              var r6, o4 = d3[t6], s3 = new URL(o4.url || u3.sign.url);
                              if (f3) {
                                var a3 = new URLSearchParams(s3.search);
                                f3.forEach(function(e4) {
                                  a3.set(e4.key, e4.values[0]);
                                }), s3.search = a3.toString();
                              }
                              if (o4.query) {
                                var c4 = new URLSearchParams(s3.search);
                                o4.query.forEach(function(e4) {
                                  c4.set(e4.key, e4.values[0]);
                                }), s3.search = c4.toString();
                              }
                              var g3 = s3.toString(), l2 = new Headers();
                              v3 && v3.forEach(function(e4) {
                                l2.set(e4.key, e4.values[0]);
                              }), o4.header && o4.header.forEach(function(e4) {
                                l2.set(e4.key, e4.values[0]);
                              }), l2.has("Content-Type") || l2.set("Content-Type", i2);
                              var I3 = e3.slice(p2[t6].start, p2[t6].end), M3 = 0;
                              return Promise.resolve(jt(function() {
                                return !r6;
                              }, void 0, function() {
                                return wt(function() {
                                  return Promise.resolve(fetch(g3, { method: "PUT", headers: l2, body: I3 })).then(function(e4) {
                                    if (!e4.ok) throw new Error("HTTP " + e4.status);
                                    var o5 = Math.min(100, Math.floor((m2 += p2[t6].end - p2[t6].start) / h2 * 100));
                                    null == n2 || n2(o5), r6 = 1;
                                  });
                                }, function(e4) {
                                  if (++M3 >= 3) throw new Error("Failed to upload chunk " + (t6 + 1) + " after 3 attempts: " + e4.message);
                                  var r7, n3 = 400 * Math.pow(2, M3 - 1), o5 = Math.floor(150 * Math.random());
                                  return Promise.resolve((r7 = n3 + o5, new Promise(function(e5) {
                                    return setTimeout(e5, r7);
                                  }))).then(function() {
                                  });
                                });
                              }));
                            } catch (e4) {
                              return Promise.reject(e4);
                            }
                          })(t5)).then(function() {
                          });
                        });
                        return Promise.resolve(t4 && t4.then ? t4.then(function() {
                        }) : void 0);
                      } catch (e4) {
                        return Promise.reject(e4);
                      }
                    }, D2 = Math.min(4, d3.length), C2 = 0; C2 < D2; C2++) M2.push(y2());
                    return Promise.resolve(Promise.all(M2)).then(function() {
                      return Promise.resolve((function(e4, t4, r6) {
                        return fetch(e4 + "/object/complete_multipart_upload", { method: "POST", headers: l({}, r6), body: JSON.stringify(t4) }).then(S);
                      })(t3.apiAddr, { uploadID: u3.uploadID, parts: g2, cause: "", name: o3, contentType: i2 }, s2)).then(function(e4) {
                        var t4 = e4.url;
                        return null == n2 || n2(100), { url: t4 };
                      });
                    });
                  });
                }
                var d2 = Math.ceil(e3.size / u2), p2 = [], g2 = [], f2 = 0, v2 = jt(function() {
                  return f2 < d2;
                }, void 0, function() {
                  var t4 = f2 * u2, r4 = Math.min(t4 + u2, e3.size), n3 = e3.slice(t4, r4);
                  return p2.push({ start: t4, end: r4 }), Promise.resolve(new Promise(function(e4, t5) {
                    var r5 = new FileReader();
                    r5.readAsArrayBuffer(n3), r5.onload = function(r6) {
                      try {
                        var n4, o4 = (null == (n4 = r6.target) ? void 0 : n4.result) || new ArrayBuffer(0), i3 = a.default.ArrayBuffer.hash(o4);
                        e4(i3);
                      } catch (e5) {
                        t5(e5);
                      }
                    }, r5.onerror = function(e5) {
                      return t5(e5);
                    };
                  })).then(function(e4) {
                    g2.push(e4), f2++;
                  });
                });
                return v2 && v2.then ? v2.then(c2) : c2();
              });
            }, function(e4) {
              return { error: e4 };
            }));
          }, t3.uploadFile = function(e3, r2) {
            try {
              return Promise.resolve(fe(t3.loginStatus, exports.RequestApi.UploadFile, r2, function() {
                try {
                  return Promise.resolve(t3.internalUploadFile(e3.file, r2)).then(function(e4) {
                    var t4 = e4.url, r3 = void 0 === t4 ? "" : t4, n2 = e4.error;
                    if (n2) throw new le(exports.ErrorCode.SdkInternalError, n2.message);
                    return { url: r3 };
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, t3.reset = function() {
            var e3;
            t3.rejectAllPendingRequests(new le(exports.ErrorCode.NetworkError, "network error, ws disconnected")), t3.loginStatus = exports.LoginStatus.Logout, null == (e3 = t3.wsManager) || e3.close(), t3.wsManager = void 0, t3.userID = void 0, t3.token = void 0, t3.apiAddr = void 0, t3.isReconnected = false, t3.connectState = "disconnected", t3.messageTrigger.reset(), t3.userTrigger.reset(), t3.groupTrigger.reset(), t3.relationTrigger.reset();
          }, t3.getSelfUserInfo = void 0, t3.setSelfInfo = void 0, t3.getUsersInfo = void 0, t3.subscribeUsersStatus = void 0, t3.unsubscribeUsersStatus = void 0, t3.getSubscribeUsersStatus = void 0, t3.acceptFriendApplication = void 0, t3.addBlack = void 0, t3.addFriend = void 0, t3.updateFriends = void 0, t3.checkFriend = void 0, t3.deleteFriend = void 0, t3.getBlackList = void 0, t3.getFriendApplicationListAsApplicant = void 0, t3.getFriendApplicationListAsRecipient = void 0, t3.getFriendListPage = void 0, t3.getSpecifiedFriendsInfo = void 0, t3.refuseFriendApplication = void 0, t3.removeBlack = void 0, t3.createGroup = void 0, t3.joinGroup = void 0, t3.inviteUserToGroup = void 0, t3.getJoinedGroupListPage = void 0, t3.getSpecifiedGroupsInfo = void 0, t3.setGroupInfo = void 0, t3.getGroupApplicationListAsRecipient = void 0, t3.getGroupApplicationListAsApplicant = void 0, t3.acceptGroupApplication = void 0, t3.refuseGroupApplication = void 0, t3.getGroupMemberList = void 0, t3.getSpecifiedGroupMembersInfo = void 0, t3.setGroupMemberInfo = void 0, t3.kickGroupMember = void 0, t3.changeGroupMemberMute = void 0, t3.changeGroupMute = void 0, t3.transferGroupOwner = void 0, t3.dismissGroup = void 0, t3.quitGroup = void 0, t3.getUsersInGroup = void 0, t3.isJoinGroup = void 0, t3.createTextMessage = void 0, t3.createTextAtMessage = void 0, t3.createLocationMessage = void 0, t3.createCustomMessage = void 0, t3.createQuoteMessage = void 0, t3.createCardMessage = void 0, t3.createImageMessageByURL = void 0, t3.createImageMessageByFile = void 0, t3.createSoundMessageByURL = void 0, t3.createSoundMessageByFile = void 0, t3.createVideoMessageByURL = void 0, t3.createVideoMessageByFile = void 0, t3.createFileMessageByURL = void 0, t3.createFileMessageByFile = void 0, t3.createMergerMessage = void 0, t3.createFaceMessage = void 0, t3.createForwardMessage = void 0, t3.sendMessage = void 0, t3.sendMessageNotOss = void 0, t3.revokeMessage = void 0, t3.getAdvancedHistoryMessageList = void 0, t3.deleteMessage = void 0, t3.deleteAllMsgFromLocalAndSvr = void 0, t3.cancelMessageTasks = void 0, t3.getConversationListSplit = void 0, t3.getOneConversation = void 0, t3.setConversation = void 0, t3.getTotalUnreadMsgCount = void 0, t3.markConversationMessageAsRead = void 0, t3.deleteConversationAndDeleteAllMsg = void 0, t3.changeInputStates = void 0, t3.getInputStates = void 0, t3.userTrigger = new yt(t3), t3.groupTrigger = new ct(t3), t3.relationTrigger = new ft(t3), t3.businessTrigger = new ht(t3), t3.messageTrigger = new it(t3), Object.assign(t3, (o2 = t3, { addFriend: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.AddFriend, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.AddFriend, data: { fromUserID: o2.userID, toUserID: e3.toUserID, reqMsg: e3.reqMsg, ex: e3.ex || "" }, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendApplicationAdded, t4), o2.relationTrigger.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationAdded, { fromUserID: o2.userID, toUserID: e3.toUserID }, t4, true);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, checkFriend: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.CheckFriend, t4, function() {
                try {
                  var r2 = e3.map(function(e4) {
                    return o2.sendHttpRequest({ reqFuncName: exports.RequestApi.CheckFriend, data: { userID1: o2.userID, userID2: e4 }, operationID: t4 });
                  });
                  return Promise.resolve(Promise.all(r2)).then(function(t5) {
                    return t5.map(function(t6, r3) {
                      return { result: Number(t6.inUser1Friends), userID: e3[r3] };
                    });
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, deleteFriend: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.DeleteFriend, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.DeleteFriend, data: { ownerUserID: o2.userID, friendUserID: e3 }, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendDeleted, t4), o2.relationTrigger.syncer.syncFriendVersion(t4);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, acceptFriendApplication: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.AcceptFriendApplication, t4, function() {
                try {
                  var r2 = { fromUserID: e3.toUserID, toUserID: o2.userID, handleResult: exports.ApplicationHandleResult.Agree, handleMsg: e3.handleMsg };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.AcceptFriendApplication, data: r2, operationID: t4 })).then(function() {
                    return o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendApplicationAccepted, t4), o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendAdded, t4), o2.relationTrigger.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationAccepted, { fromUserID: e3.toUserID, toUserID: o2.userID }, t4, true), Promise.resolve(o2.relationTrigger.syncer.syncFriendVersion(t4)).then(function() {
                      var r3 = (function() {
                        if (!o2.relationTrigger.cache.isFriend(e3.toUserID)) {
                          var r4 = (function(r5, n2) {
                            try {
                              var i2 = Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSpecifiedFriendsInfo, data: { ownerUserID: o2.userID, friendUserIDs: [e3.toUserID] }, operationID: t4 })).then(function(r6) {
                                var n3 = r6.friendsInfo;
                                n3 && n3[0] && (o2.relationTrigger.cache.addNewFriend(e3.toUserID), o2.triggerEvent({ event: exports.CbEvents.OnFriendAdded, data: He(n3[0]), operationID: t4 }));
                              });
                            } catch (e4) {
                              return n2(e4);
                            }
                            return i2 && i2.then ? i2.then(void 0, n2) : i2;
                          })(0, function(e4) {
                            s.default.warn("[acceptFriendApplication] recovery emit failed", "opid:", t4, e4);
                          });
                          if (r4 && r4.then) return r4.then(function() {
                          });
                        }
                      })();
                      if (r3 && r3.then) return r3.then(function() {
                      });
                    });
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, refuseFriendApplication: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.RefuseFriendApplication, t4, function() {
                try {
                  var r2 = { fromUserID: e3.toUserID, toUserID: o2.userID, handleResult: exports.ApplicationHandleResult.Reject, handleMsg: e3.handleMsg };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.RefuseFriendApplication, data: r2, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendApplicationRejected, t4), o2.relationTrigger.getDesignatedFriendApplicationAndTrigger(exports.CbEvents.OnFriendApplicationRejected, { fromUserID: o2.userID, toUserID: e3.toUserID }, t4, true);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, getFriendListPage: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.GetFriendListPage, t4, function() {
                try {
                  var r2 = { userID: o2.userID, pagination: { pageNumber: Math.round(e3.offset / e3.count) + 1, showNumber: e3.count } };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetFriendListPage, data: r2, operationID: t4 })).then(function(e4) {
                    var t5 = e4.friendsInfo;
                    return (null != t5 ? t5 : []).map(He);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, getSpecifiedFriendsInfo: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.GetSpecifiedFriendsInfo, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSpecifiedFriendsInfo, data: { ownerUserID: o2.userID, friendUserIDs: e3 }, operationID: t4 })).then(function(e4) {
                    var t5 = e4.friendsInfo;
                    return (null != t5 ? t5 : []).map(He);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, getFriendApplicationListAsApplicant: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.GetFriendApplicationListAsApplicant, t4, function() {
                try {
                  var r2 = e3.count, n2 = { userID: o2.userID, pagination: { pageNumber: Math.round(e3.offset / r2) + 1, showNumber: r2 }, handleResults: [] };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetFriendApplicationListAsApplicant, data: n2, operationID: t4 })).then(function(e4) {
                    var t5 = e4.friendRequests;
                    return null != t5 ? t5 : [];
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, getFriendApplicationListAsRecipient: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.GetFriendApplicationListAsRecipient, t4, function() {
                try {
                  var r2 = e3.count, n2 = { userID: o2.userID, pagination: { pageNumber: Math.round(e3.offset / r2) + 1, showNumber: r2 }, handleResults: [] };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetFriendApplicationListAsRecipient, data: n2, operationID: t4 })).then(function(e4) {
                    var t5 = e4.FriendRequests;
                    return null != t5 ? t5 : [];
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, updateFriends: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.UpdateFriends, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.UpdateFriends, data: { ownerUserID: o2.userID, friendUserIDs: e3.friendUserIDs, remark: e3.remark, isPinned: e3.isPinned, ex: e3.ex }, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnFriendInfoChanged, t4), o2.relationTrigger.syncer.syncFriendVersion(t4);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, addBlack: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.AddBlack, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.AddBlack, data: { ownerUserID: o2.userID, blackUserID: e3.toUserID, ex: e3.ex }, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnBlackAdded, t4), o2.relationTrigger.getDesignatedBlackUserAndTrigger(exports.CbEvents.OnBlackAdded, e3.toUserID, t4, true);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, removeBlack: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.RemoveBlack, t4, function() {
                try {
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.RemoveBlack, data: { ownerUserID: o2.userID, blackUserID: e3 }, operationID: t4 })).then(function() {
                    o2.relationTrigger.setTriggeredEventMap(exports.CbEvents.OnBlackDeleted, t4), o2.relationTrigger.getDesignatedBlackUserAndTrigger(exports.CbEvents.OnBlackDeleted, e3, t4, true);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          }, getBlackList: function(e3, t4) {
            try {
              return Promise.resolve(fe(o2.loginStatus, exports.RequestApi.GetBlackList, t4, function() {
                try {
                  var r2 = e3.count, n2 = { userID: o2.userID, pagination: { pageNumber: Math.round(e3.offset / r2) + 1, showNumber: r2 } };
                  return Promise.resolve(o2.sendHttpRequest({ reqFuncName: exports.RequestApi.GetBlackList, data: n2, operationID: t4 })).then(function(e4) {
                    var t5 = e4.blacks;
                    return (null != t5 ? t5 : []).map(Je);
                  });
                } catch (e4) {
                  return Promise.reject(e4);
                }
              }));
            } catch (e4) {
              return Promise.reject(e4);
            }
          } })), Object.assign(t3, /* @__PURE__ */ (function(e3) {
            return { createGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.CreateGroup, r2, function() {
                  try {
                    var n2, o3 = { ownerUserID: e3.userID, memberUserIDs: t4.memberUserIDs, adminUserIDs: null != (n2 = t4.adminUserIDs) ? n2 : [], groupInfo: l({}, t4.groupInfo, { groupType: 2, creatorUserID: e3.userID }) };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.CreateGroup, data: o3, operationID: r2 })).then(function(e4) {
                      return e4.groupInfo;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, joinGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.JoinGroup, r2, function() {
                  try {
                    var n2, o3 = { groupID: t4.groupID, reqMessage: t4.reqMsg, joinSource: t4.joinSource, inviterUserID: e3.userID, ex: null != (n2 = t4.ex) ? n2 : "" };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.JoinGroup, data: o3, operationID: r2 })).then(function() {
                      return e3.groupTrigger.setTriggeredEventMap(exports.CbEvents.OnGroupApplicationAdded, r2), e3.groupTrigger.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationAdded, groupID: t4.groupID, operationID: r2, activeTrigger: true }), null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, inviteUserToGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.InviteUserToGroup, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.InviteUserToGroup, data: { groupID: t4.groupID, reason: t4.reason, invitedUserIDs: t4.userIDList }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getJoinedGroupListPage: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetJoinedGroupListPage, r2, function() {
                  try {
                    var n2 = { fromUserID: e3.userID, pagination: { pageNumber: Math.round(t4.offset / t4.count) + 1, showNumber: t4.count } };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetJoinedGroupListPage, data: n2, operationID: r2 })).then(function(t5) {
                      var r3 = t5.groups;
                      return r3 && e3.groupTrigger.cache.updateCachedGroups(r3), null != r3 ? r3 : [];
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getSpecifiedGroupsInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetSpecifiedGroupsInfo, r2, function() {
                  return e3.groupTrigger.cache.getGroupInfosWithCache(t4, r2);
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, setGroupInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SetGroupInfo, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.SetGroupInfo, data: t4, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, acceptGroupApplication: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.AcceptGroupApplication, r2, function() {
                  try {
                    var n2 = { groupID: t4.groupID, fromUserID: t4.fromUserID, handledMsg: t4.handleMsg, handleResult: exports.ApplicationHandleResult.Agree };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.AcceptGroupApplication, data: n2, operationID: r2 })).then(function() {
                      return e3.groupTrigger.setTriggeredEventMap(exports.CbEvents.OnGroupApplicationAccepted, r2), e3.groupTrigger.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationAccepted, groupID: t4.groupID, userID: t4.fromUserID, operationID: r2, activeTrigger: true }), null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, refuseGroupApplication: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.RefuseGroupApplication, r2, function() {
                  try {
                    var n2 = { groupID: t4.groupID, fromUserID: t4.fromUserID, handledMsg: t4.handleMsg, handleResult: exports.ApplicationHandleResult.Reject };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.RefuseGroupApplication, data: n2, operationID: r2 })).then(function() {
                      return e3.groupTrigger.setTriggeredEventMap(exports.CbEvents.OnGroupApplicationRejected, r2), e3.groupTrigger.getDesignatedGroupApplicationAndTrigger({ event: exports.CbEvents.OnGroupApplicationRejected, groupID: t4.groupID, userID: t4.fromUserID, operationID: r2, activeTrigger: true }), null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getGroupMemberList: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetGroupMemberList, r2, function() {
                  try {
                    var n2 = { filter: 0, keyword: "", groupID: t4.groupID, pagination: { pageNumber: Math.round(t4.offset / t4.count) + 1, showNumber: t4.count } };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetGroupMemberList, data: n2, operationID: r2 })).then(function(t5) {
                      var r3 = t5.members;
                      return r3 && e3.groupTrigger.cache.updateCachedGroupMembers(r3), null != r3 ? r3 : [];
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getSpecifiedGroupMembersInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetSpecifiedGroupMembersInfo, r2, function() {
                  return e3.groupTrigger.cache.getGroupMembersWithCache(l({}, t4, { operationID: r2 }));
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, setGroupMemberInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SetGroupMemberInfo, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.SetGroupMemberInfo, data: { members: [l({}, t4)] }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, kickGroupMember: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.KickGroupMember, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.KickGroupMember, data: { reason: t4.reason, groupID: t4.groupID, kickedUserIDs: t4.userIDList, deleteMember: false }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, changeGroupMemberMute: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.ChangeGroupMemberMute, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ replaceURL: t4.mutedSeconds ? "/group/mute_group_member" : "/group/cancel_mute_group_member", reqFuncName: exports.RequestApi.ChangeGroupMemberMute, data: { groupID: t4.groupID, userID: t4.userID, mutedSeconds: t4.mutedSeconds }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, changeGroupMute: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.ChangeGroupMute, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ replaceURL: t4.isMute ? "/group/mute_group" : "/group/cancel_mute_group", reqFuncName: exports.RequestApi.ChangeGroupMute, data: { groupID: t4.groupID }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, transferGroupOwner: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.TransferGroupOwner, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.TransferGroupOwner, data: { groupID: t4.groupID, oldOwnerUserID: e3.userID, newOwnerUserID: t4.newOwnerUserID }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, dismissGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.DismissGroup, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.DismissGroup, data: { groupID: t4, deleteMember: false }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, quitGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.QuitGroup, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.QuitGroup, data: { groupID: t4, userID: e3.userID, deleteMember: false }, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getGroupApplicationListAsRecipient: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetGroupApplicationListAsRecipient, r2, function() {
                  try {
                    var n2 = t4.count, o3 = { fromUserID: e3.userID, pagination: { pageNumber: Math.round(t4.offset / n2) + 1, showNumber: n2 }, groupIDs: [], handleResults: [] };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetGroupApplicationListAsRecipient, data: o3, operationID: r2 })).then(function(e4) {
                      var t5 = e4.groupRequests;
                      return (null != t5 ? t5 : []).map(Le);
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getGroupApplicationListAsApplicant: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetGroupApplicationListAsApplicant, r2, function() {
                  try {
                    var n2 = t4.count, o3 = { userID: e3.userID, pagination: { pageNumber: Math.round(t4.offset / n2) + 1, showNumber: n2 }, groupIDs: [], handleResults: [] };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetGroupApplicationListAsApplicant, data: o3, operationID: r2 })).then(function(e4) {
                      var t5 = e4.groupRequests;
                      return (null != t5 ? t5 : []).map(Le);
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getUsersInGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetUsersInGroup, r2, function() {
                  try {
                    var n2 = function() {
                      var r3, n3 = e3.groupTrigger.cache.getCachedGroupMembersID(t4.groupID);
                      return null == (r3 = t4.userIDList) ? void 0 : r3.filter(function(e4) {
                        return n3.includes(e4);
                      });
                    }, o3 = (function() {
                      if (!e3.groupTrigger.cache.hasCachedGroupMembersID(t4.groupID)) return Promise.resolve(e3.groupTrigger.cache.getGroupMembersID(t4.groupID, r2)).then(function() {
                      });
                    })();
                    return Promise.resolve(o3 && o3.then ? o3.then(n2) : n2());
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, isJoinGroup: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.IsJoinGroup, r2, function() {
                  try {
                    return Promise.resolve(e3.groupTrigger.syncer.checkIsJoinGroup(t4));
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            } };
          })(t3)), Object.assign(t3, /* @__PURE__ */ (function(e3) {
            return { getSelfUserInfo: function(t4) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetSelfUserInfo, t4, function() {
                  try {
                    var r2 = e3.userTrigger.cache.getSelfUserInfo();
                    return r2 ? Promise.resolve(r2) : Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetSelfUserInfo, data: { userIDs: [e3.userID] }, operationID: t4 })).then(function(e4) {
                      var t5 = e4.usersInfo;
                      return (null != t5 ? t5 : [])[0];
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, setSelfInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SetSelfInfo, r2, function() {
                  try {
                    var n2 = { userInfo: l({}, t4, { userID: e3.userID }) };
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.SetSelfInfo, data: n2, operationID: r2 })).then(function() {
                      return e3.userTrigger.setTriggeredEventMap(r2), e3.userTrigger.cache.udpateCachedLoginUserInfoAndTrigger(l({}, t4), r2), null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getUsersInfo: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetUsersInfo, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.GetUsersInfo, data: { userIDs: t4 }, operationID: r2 })).then(function(t5) {
                      var r3 = t5.usersInfo, n2 = null != r3 ? r3 : [];
                      return n2.filter(function(t6) {
                        return !e3.relationTrigger.cache.isFriend(t6.userID);
                      }).map(e3.userTrigger.checkConversationUpdate), n2;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, subscribeUsersStatus: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SubscribeUsersStatus, r2, function() {
                  if (!t4.length) throw new le(exports.ErrorCode.ArgsError, "sub users is empty");
                  return e3.userTrigger.onlineSub.getUserOnlineState(t4, r2);
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, unsubscribeUsersStatus: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.UnsubscribeUsersStatus, r2, function() {
                  try {
                    if (!t4.length) throw new le(exports.ErrorCode.ArgsError, "unSub users is empty");
                    return Promise.resolve(e3.userTrigger.onlineSub.updateSubs({ sub: [], unSub: t4, operationID: r2 })).then(function() {
                      return null;
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getSubscribeUsersStatus: function(t4) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetSubscribeUsersStatus, t4, function() {
                  try {
                    return Promise.resolve(e3.userTrigger.onlineSub.getAllSubUsersOnlineState());
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            } };
          })(t3)), Object.assign(t3, (function(e3) {
            var t4 = /* @__PURE__ */ new Map(), r2 = new bt(), o3 = new bt(), i2 = /* @__PURE__ */ new Map(), a2 = function(t5) {
              var r3 = t5.maxSeq, n2 = t5.count, o4 = t5.conversationID, i3 = t5.operationID, s2 = t5.fetchedMessages, u3 = void 0 === s2 ? [] : s2;
              try {
                for (var c2 = [], d2 = r3; c2.length < n2 && !(d2 < 1); d2--) e3.messageTrigger.cache.checkIsFilterSeq(o4, d2) || c2.push(d2);
                return c2.length ? Promise.resolve(e3.messageTrigger.getMessageWithCacheBySeqs(o4, c2, i3)).then(function(e4) {
                  var t6 = e4.messages, s3 = e4.filterCount, d3 = [].concat(t6, u3);
                  if (!s3 && t6.length < n2) return d3;
                  if (t6.length < n2) {
                    var p2 = c2[c2.length - 1], g2 = r3 - n2;
                    return a2({ maxSeq: p2 < g2 ? p2 : g2, count: n2 - t6.length, conversationID: o4, operationID: i3, fetchedMessages: d3 });
                  }
                  return d3;
                }) : Promise.resolve(u3);
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, u2 = function(t5) {
              var r3 = t5.minSeq, n2 = t5.count, o4 = t5.conversationID, i3 = t5.operationID, s2 = t5.fetchedMessages, a3 = void 0 === s2 ? [] : s2;
              try {
                for (var c2 = [], d2 = r3; c2.length < n2; d2++) e3.messageTrigger.cache.checkIsFilterSeq(o4, d2) || c2.push(d2);
                return c2.length ? Promise.resolve(e3.messageTrigger.getMessageWithCacheBySeqs(o4, c2, i3)).then(function(e4) {
                  var t6 = e4.messages, s3 = e4.filterCount, d3 = [].concat(a3, t6);
                  if (!s3 && t6.length < n2) return d3;
                  if (t6.length < n2) {
                    var p2 = c2[c2.length - 1], g2 = r3 + n2;
                    return u2({ minSeq: p2 > g2 ? p2 : g2, count: n2 - t6.length, conversationID: o4, operationID: i3, fetchedMessages: d3 });
                  }
                  return d3;
                }) : Promise.resolve(a3);
              } catch (e4) {
                return Promise.reject(e4);
              }
            };
            return { createTextMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateTextMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.TextMessage);
                  return r4.textElem = { content: t5 }, Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createTextAtMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateTextAtMessage, r3, function() {
                try {
                  var r4;
                  if (!t5.text) throw new le(exports.ErrorCode.ArgsError, "text cannot be empty");
                  if (t5.atUserIDList.length > 10) throw new le(exports.ErrorCode.ArgsError, "atUserIDList length must be less than 10");
                  var n2, o4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.AtTextMessage);
                  return (null == (r4 = t5.message) ? void 0 : r4.contentType) === exports.MessageType.QuoteMessage && (t5.message.contentType = exports.MessageType.TextMessage, t5.message.textElem = { content: null == (n2 = t5.message.quoteElem) ? void 0 : n2.text }), o4.atTextElem = { text: t5.text, atUserList: t5.atUserIDList, atUsersInfo: t5.atUsersInfo, quoteMessage: t5.message }, Promise.resolve(o4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createLocationMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateLocationMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.LocationMessage);
                  return r4.locationElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createCustomMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateCustomMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.CustomMessage);
                  return r4.customElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createQuoteMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateQuoteMessage, r3, function() {
                try {
                  var r4, n2 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.QuoteMessage), o4 = JSON.parse(t5.message);
                  return o4.contentType === exports.MessageType.QuoteMessage && (o4.contentType = exports.MessageType.TextMessage, o4.textElem = { content: null == (r4 = o4.quoteElem) ? void 0 : r4.text }), n2.quoteElem = { text: t5.text, quoteMessage: o4 }, Promise.resolve(n2);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createCardMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateCardMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.CardMessage);
                  return r4.cardElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createImageMessageByURL: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateImageMessageByURL, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.PictureMessage);
                  return r4.pictureElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createImageMessageByFile: function(r3, n2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.CreateImageMessageByFile, n2, function() {
                  try {
                    var n3 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.PictureMessage);
                    return t4.set(r3.sourcePicture.uuid, r3.file), delete r3.file, n3.pictureElem = l({}, r3), Promise.resolve(n3);
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, createSoundMessageByURL: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateSoundMessageByURL, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.VoiceMessage);
                  return r4.soundElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createSoundMessageByFile: function(r3, n2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.CreateSoundMessageByFile, n2, function() {
                  try {
                    var n3 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.VoiceMessage);
                    return t4.set(r3.uuid, r3.file), delete r3.file, n3.soundElem = l({}, r3), Promise.resolve(n3);
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, createVideoMessageByURL: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateVideoMessageByURL, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.VideoMessage);
                  return r4.videoElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createVideoMessageByFile: function(r3, n2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.CreateVideoMessageByFile, n2, function() {
                  try {
                    var n3 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.VideoMessage);
                    return t4.set(r3.videoUUID, r3.videoFile), t4.set(r3.snapshotUUID, r3.snapshotFile), delete r3.videoFile, delete r3.snapshotFile, n3.videoElem = l({}, r3), Promise.resolve(n3);
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, createFileMessageByURL: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateFileMessageByURL, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.FileMessage);
                  return r4.fileElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createFileMessageByFile: function(r3, n2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.CreateFileMessageByFile, n2, function() {
                  try {
                    var n3 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.FileMessage);
                    return t4.set(r3.uuid, r3.file), delete r3.file, n3.fileElem = l({}, r3), Promise.resolve(n3);
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, createMergerMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateMergerMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.MergeMessage);
                  return r4.mergeElem = { title: t5.title, abstractList: t5.summaryList, multiMessage: t5.messageList, messageEntityList: [] }, Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createFaceMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateFaceMessage, r3, function() {
                try {
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, exports.MessageType.FaceMessage);
                  return r4.faceElem = l({}, t5), Promise.resolve(r4);
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, createForwardMessage: function(t5, r3) {
              return fe(e3.loginStatus, exports.RequestApi.CreateForwardMessage, r3, function() {
                try {
                  if (t5.status !== exports.MessageStatus.Succeed) throw new le(exports.ErrorCode.ArgsError, "Only successfully sent messages can be forwarded");
                  var r4 = pe(e3, exports.MsgFrom.UserMsgType, t5.contentType);
                  return Promise.resolve(l({}, t5, r4, { seq: 0, status: exports.MessageStatus.Sending }));
                } catch (e4) {
                  return Promise.reject(e4);
                }
              });
            }, sendMessage: function(i3, s2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SendMessage, s2, function() {
                  var a3 = function() {
                    try {
                      var r3 = l({}, i3, { message: l({}, i3.message) }), o4 = r3.message, a4 = r3.recvID, u3 = r3.groupID, c2 = r3.isOnlineOnly, d2 = r3.offlinePushInfo, p2 = void 0 === d2 ? { title: "you hava a new message.", desc: "you hava a new message.", ex: "", iOSPushSound: "", iOSBadgeCount: true, signalInfo: "" } : d2;
                      void 0 === p2.signalInfo && (p2.signalInfo = "");
                      var g2 = Rt[o4.contentType];
                      if (!g2) throw new le(exports.ErrorCode.MsgContentTypeNotSupportError, "Unknown message content type");
                      o4.recvID = a4, o4.groupID = u3, o4.sessionType = u3 ? exports.SessionType.Group : exports.SessionType.Single;
                      var f2 = {};
                      c2 && Object.values(exports.MessageOptionsKey).forEach(function(e4) {
                        return f2[e4] = false;
                      });
                      var v2 = se(o4), h2 = false;
                      return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(v2, s2)).then(function(r4) {
                        function i4() {
                          function i5(i6) {
                            function c5(i7) {
                              function c6(i8) {
                                function c7(i9) {
                                  function c8(t5) {
                                    var i10, c9, d7 = JSON.stringify(o4[g2]), l2 = n.PbCoder.MsgData.encode({ sendID: e3.userID, recvID: a4 || "", groupID: u3 || "", clientMsgID: o4.clientMsgID, serverMsgID: o4.serverMsgID || "", senderPlatformID: e3.platform, senderNickname: o4.senderNickname, senderFaceURL: o4.senderFaceUrl, sessionType: o4.sessionType, msgFrom: o4.msgFrom, contentType: o4.contentType, content: Ee(d7), seq: o4.seq, sendTime: 0, createTime: o4.createTime, status: o4.status, isRead: false, options: f2, offlinePushInfo: p2, atUserIDList: null != (i10 = null == (c9 = o4.atTextElem) ? void 0 : c9.atUserList) ? i10 : [], attachedInfo: o4.attachedInfoElem ? JSON.stringify(o4.attachedInfoElem) : "", ex: o4.ex || "", keyVersion: 0, dstUserIDs: [] }).finish();
                                    return At(function() {
                                      return Promise.resolve(e3.sendReqWaitResp({ data: l2, operationID: s2, reqIdentifier: exports.ReqIdentifier.SendMsg })).then(function(t6) {
                                        var n2 = t6.serverMsgID, i11 = t6.sendTime;
                                        return o4.sendTime = i11, o4.serverMsgID = n2, o4.status = exports.MessageStatus.Succeed, e3.messageTrigger.setTriggeredConversationEvent(s2), e3.messageTrigger.cache.updateCachedMaxReadSeq(r4.conversationID, { maxSeqTime: i11 }), e3.messageTrigger.getOneConversationAndTryChange(v2, s2, { latestMsg: JSON.stringify(o4), latestMsgSendTime: i11 }), o4;
                                      });
                                    }, function(t6) {
                                      throw o4.status = exports.MessageStatus.Failed, e3.messageTrigger.getOneConversationAndTryChange(v2, s2, { latestMsg: JSON.stringify(o4) }), t6;
                                    });
                                  }
                                  var d6 = (function() {
                                    if (o4.contentType === exports.MessageType.FileMessage) {
                                      var r5, n2 = t4.get(null == (r5 = o4.fileElem) ? void 0 : r5.uuid);
                                      if (!n2) throw new le(exports.ErrorCode.ArgsError, "Can not find target file");
                                      return Promise.resolve(e3.internalUploadFile(n2, s2, function(t5) {
                                        return e3.triggerEvent({ event: exports.CbEvents.OnProgress, data: { progress: t5, clientMsgID: o4.clientMsgID }, operationID: s2 });
                                      })).then(function(e4) {
                                        var r6, n3 = e4.url, i10 = void 0 === n3 ? "" : n3, s3 = e4.error;
                                        if (t4.delete(null == (r6 = o4.fileElem) ? void 0 : r6.uuid), s3) throw new le(exports.ErrorCode.NetworkError, "Upload file failed");
                                        o4.fileElem.sourceUrl = i10;
                                      });
                                    }
                                  })();
                                  return d6 && d6.then ? d6.then(c8) : c8();
                                }
                                var d5 = (function() {
                                  if (o4.contentType === exports.MessageType.VideoMessage) {
                                    var r5, n2, i9 = t4.get(null == (r5 = o4.videoElem) ? void 0 : r5.videoUUID), a5 = t4.get(null == (n2 = o4.videoElem) ? void 0 : n2.snapshotUUID);
                                    if (!i9 || !a5) throw new le(exports.ErrorCode.ArgsError, "Can not find target file");
                                    var u4 = 0, c8 = 0, d6 = i9.size, p3 = a5.size, g3 = d6 + p3, l2 = function() {
                                      e3.triggerEvent({ event: exports.CbEvents.OnProgress, data: { progress: (u4 * d6 + c8 * p3) / g3, clientMsgID: o4.clientMsgID }, operationID: s2 });
                                    };
                                    return Promise.resolve(Promise.all([e3.internalUploadFile(i9, s2, function(e4) {
                                      u4 = e4, l2();
                                    }), e3.internalUploadFile(a5, s2, function(e4) {
                                      c8 = e4, l2();
                                    })])).then(function(e4) {
                                      var r6, n3;
                                      if (t4.delete(null == (r6 = o4.videoElem) ? void 0 : r6.videoUUID), t4.delete(null == (n3 = o4.videoElem) ? void 0 : n3.snapshotUUID), e4[0].error || e4[1].error) throw new le(exports.ErrorCode.NetworkError, "Upload file failed");
                                      o4.videoElem.videoUrl = e4[0].url, o4.videoElem.snapshotUrl = e4[1].url;
                                    });
                                  }
                                })();
                                return d5 && d5.then ? d5.then(c7) : c7();
                              }
                              var d4 = (function() {
                                if (o4.contentType === exports.MessageType.VoiceMessage) {
                                  var r5, n2 = t4.get(null == (r5 = o4.soundElem) ? void 0 : r5.uuid);
                                  if (!n2) throw new le(exports.ErrorCode.ArgsError, "Can not find target file");
                                  return Promise.resolve(e3.internalUploadFile(n2, s2, function(t5) {
                                    return e3.triggerEvent({ event: exports.CbEvents.OnProgress, data: { progress: t5, clientMsgID: o4.clientMsgID }, operationID: s2 });
                                  })).then(function(e4) {
                                    var r6, n3 = e4.url, i8 = void 0 === n3 ? "" : n3, s3 = e4.error;
                                    if (t4.delete(null == (r6 = o4.soundElem) ? void 0 : r6.uuid), s3) throw new le(exports.ErrorCode.NetworkError, "Upload file failed");
                                    o4.soundElem.sourceUrl = i8;
                                  });
                                }
                              })();
                              return d4 && d4.then ? d4.then(c6) : c6();
                            }
                            r4.latestMsgSendTime = o4.createTime, e3.messageTrigger.getOneConversationAndTryChange(v2, s2, { latestMsg: JSON.stringify(o4) }, void 0, h2);
                            var d3 = (function() {
                              if (o4.contentType === exports.MessageType.PictureMessage) {
                                var r5, n2 = t4.get(null == (r5 = o4.pictureElem) ? void 0 : r5.sourcePicture.uuid);
                                if (!n2) throw new le(exports.ErrorCode.ArgsError, "Can not find target file");
                                return Promise.resolve(e3.internalUploadFile(n2, s2, function(t5) {
                                  return e3.triggerEvent({ event: exports.CbEvents.OnProgress, data: { progress: t5, clientMsgID: o4.clientMsgID }, operationID: s2 });
                                })).then(function(e4) {
                                  var r6, n3 = e4.url, i7 = void 0 === n3 ? "" : n3, s3 = e4.error;
                                  if (t4.delete(null == (r6 = o4.pictureElem) ? void 0 : r6.sourcePicture.uuid), s3) throw new le(exports.ErrorCode.NetworkError, "Upload file failed");
                                  o4.pictureElem.sourcePicture.url = i7, o4.pictureElem.bigPicture.url = i7, o4.pictureElem.snapshotPicture.width = 640, o4.pictureElem.snapshotPicture.height = 640, o4.pictureElem.snapshotPicture.url = i7 + "?type=image&width=640&height=640";
                                });
                              }
                            })();
                            return d3 && d3.then ? d3.then(c5) : c5();
                          }
                          var c4 = (function() {
                            if (u3) return Promise.resolve(e3.groupTrigger.cache.getGroupMembersWithCache({ groupID: u3, userIDList: [e3.userID], operationID: s2 })).then(function(e4) {
                              if (null == e4 || !e4.length) throw new le(exports.ErrorCode.ArgsError, "user not join target group");
                              e4[0].nickname && (o4.senderNickname = e4[0].nickname);
                            });
                          })();
                          return c4 && c4.then ? c4.then(i5) : i5();
                        }
                        var c3 = (function() {
                          if (!r4) return h2 = true, Promise.resolve(e3.messageTrigger.initConversation({ sourceID: u3 || a4, sessionType: o4.sessionType, operationID: s2 })).then(function(e4) {
                            r4 = e4;
                          });
                          r4.isPrivateChat && (f2[exports.MessageOptionsKey.IsNotPrivate] = false, o4.attachedInfoElem = l({}, { groupHasReadInfo: { hasReadCount: 0, unreadCount: 0 }, isPrivateChat: false, burnDuration: 0, hasReadTime: 0, messageEntityList: [], isEncryption: false, inEncryptStatus: false }, { isPrivateChat: true, burnDuration: r4.burnDuration }));
                        })();
                        return c3 && c3.then ? c3.then(i4) : i4();
                      });
                    } catch (e4) {
                      return Promise.reject(e4);
                    }
                  };
                  return Pt.includes(i3.message.contentType) ? o3.enqueue(a3) : r2.enqueue(a3);
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, sendMessageNotOss: function(t5, o4) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SendMessage, o4, function() {
                  return r2.enqueue(function() {
                    try {
                      var r3 = l({}, t5, { message: l({}, t5.message) }), i3 = r3.message, s2 = r3.recvID, a3 = r3.groupID, u3 = r3.isOnlineOnly, c2 = r3.offlinePushInfo, d2 = void 0 === c2 ? { title: "you hava a new message.", desc: "you hava a new message.", ex: "", iOSPushSound: "", iOSBadgeCount: true, signalInfo: "" } : c2;
                      void 0 === d2.signalInfo && (d2.signalInfo = "");
                      var p2 = Rt[i3.contentType];
                      if (!p2) throw new le(exports.ErrorCode.MsgContentTypeNotSupportError, "Unknown message content type");
                      i3.recvID = s2, i3.groupID = a3, i3.sessionType = a3 ? exports.SessionType.Group : exports.SessionType.Single;
                      var g2 = {};
                      u3 && Object.values(exports.MessageOptionsKey).forEach(function(e4) {
                        return g2[e4] = false;
                      });
                      var f2 = se(i3);
                      return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(f2, o4)).then(function(t6) {
                        function r4(r5) {
                          var u5, c3;
                          t6.latestMsgSendTime = i3.createTime, e3.messageTrigger.getOneConversationAndTryChange(f2, o4, { latestMsg: JSON.stringify(i3) });
                          var l2 = JSON.stringify(i3[p2]), v2 = n.PbCoder.MsgData.encode({ sendID: e3.userID, recvID: s2 || "", groupID: a3 || "", clientMsgID: i3.clientMsgID, serverMsgID: i3.serverMsgID || "", senderPlatformID: e3.platform, senderNickname: i3.senderNickname, senderFaceURL: i3.senderFaceUrl, sessionType: i3.sessionType, msgFrom: i3.msgFrom, contentType: i3.contentType, content: Ee(l2), seq: i3.seq, sendTime: 0, createTime: i3.createTime, status: i3.status, isRead: false, options: g2, offlinePushInfo: d2, atUserIDList: null != (u5 = null == (c3 = i3.atTextElem) ? void 0 : c3.atUserList) ? u5 : [], attachedInfo: i3.attachedInfoElem ? JSON.stringify(i3.attachedInfoElem) : "", ex: i3.ex || "", keyVersion: 0, dstUserIDs: [] }).finish();
                          return At(function() {
                            return Promise.resolve(e3.sendReqWaitResp({ data: v2, operationID: o4, reqIdentifier: exports.ReqIdentifier.SendMsg })).then(function(r6) {
                              var n2 = r6.serverMsgID, s3 = r6.sendTime;
                              return i3.sendTime = s3, i3.serverMsgID = n2, i3.status = exports.MessageStatus.Succeed, e3.messageTrigger.setTriggeredConversationEvent(o4), e3.messageTrigger.cache.updateCachedMaxReadSeq(t6.conversationID, { maxSeqTime: s3 }), e3.messageTrigger.getOneConversationAndTryChange(f2, o4, { latestMsg: JSON.stringify(i3), latestMsgSendTime: s3 }), i3;
                            });
                          }, function(t7) {
                            throw i3.status = exports.MessageStatus.Failed, e3.messageTrigger.getOneConversationAndTryChange(f2, o4, { latestMsg: JSON.stringify(i3) }), t7;
                          });
                        }
                        var u4 = (function() {
                          if (!t6) return Promise.resolve(e3.messageTrigger.initConversation({ sourceID: a3 || s2, sessionType: i3.sessionType, operationID: o4 })).then(function(r5) {
                            return t6 = r5, (function() {
                              if (a3) return Promise.resolve(e3.groupTrigger.cache.getGroupMembersWithCache({ groupID: a3, userIDList: [e3.userID], operationID: o4 })).then(function(e4) {
                                if (null == e4 || !e4.length) throw new le(exports.ErrorCode.ArgsError, "user not join target group");
                                e4[0].nickname && (i3.senderNickname = e4[0].nickname);
                              });
                            })();
                          });
                          t6.isPrivateChat && (g2[exports.MessageOptionsKey.IsNotPrivate] = false, i3.attachedInfoElem = l({}, { groupHasReadInfo: { hasReadCount: 0, unreadCount: 0 }, isPrivateChat: false, burnDuration: 0, hasReadTime: 0, messageEntityList: [], isEncryption: false, inEncryptStatus: false }, { isPrivateChat: true, burnDuration: t6.burnDuration }));
                        })();
                        return u4 && u4.then ? u4.then(r4) : r4();
                      });
                    } catch (e4) {
                      return Promise.reject(e4);
                    }
                  });
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, revokeMessage: function(t5, r3) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.RevokeMessage, r3, function() {
                  try {
                    var n2 = function(n3) {
                      return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.RevokeMessage, data: { conversationID: t5.conversationID, seq: o4.seq, userID: e3.userID }, operationID: r3 })).then(function() {
                        e3.messageTrigger.setTriggeredConversationEvent(r3), e3.messageTrigger.revokeMessage({ revokerUserID: e3.userID, clientMsgID: o4.clientMsgID, revokeTime: Date.now(), sesstionType: o4.sessionType, seq: o4.seq, conversationID: t5.conversationID, isAdminRevoke: false }, r3);
                      });
                    }, o4 = e3.messageTrigger.cache.getCachedMessageByClientMsgIDs(t5.conversationID, [t5.clientMsgID])[0];
                    if (!o4) throw new le(exports.ErrorCode.ArgsError, "message not exist");
                    if (o4.contentType === exports.NotificationType.RevokeNotification) throw new le(exports.ErrorCode.ArgsError, "message already revoked");
                    var i3 = (function() {
                      if (o4.sendID !== e3.userID) {
                        if (!o4.groupID) throw new le(exports.ErrorCode.ArgsError, "message can not be revoked");
                        return Promise.resolve(e3.groupTrigger.cache.getGroupMembersWithCache({ groupID: o4.groupID, userIDList: [e3.userID], operationID: r3 })).then(function(e4) {
                          var t6 = e4[0];
                          if (!t6 || t6.roleLevel === exports.GroupMemberRole.Nomal) throw new le(exports.ErrorCode.ArgsError, "message can not be revoked");
                        });
                      }
                    })();
                    return Promise.resolve(i3 && i3.then ? i3.then(n2) : n2());
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getAdvancedHistoryMessageList: function(t5, r3) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetAdvancedHistoryMessageList, r3, function() {
                  try {
                    var n2, o4 = { isEnd: false, errCode: 0, errMsg: "", messageList: [] }, u3 = t5.startClientMsgID ? t5.conversationID + ":" + t5.startClientMsgID : "", c2 = null;
                    if (u3 && i2.has(u3)) {
                      if (null === (c2 = null != (n2 = i2.get(u3)) ? n2 : null)) return Promise.resolve(l({}, o4, { isEnd: true }));
                    } else if (t5.startClientMsgID) {
                      var d2 = e3.messageTrigger.cache.getCachedMessageByClientMsgIDs(t5.conversationID, [t5.startClientMsgID])[0];
                      if (!d2) return Promise.resolve(l({}, o4, { isEnd: true }));
                      c2 = d2.seq;
                    } else c2 = 0;
                    var p2 = e3.messageTrigger.cache.getCachedMaxReadSeq(t5.conversationID);
                    return s.default.log("syncedSeqs", p2), p2 ? Promise.resolve(a2({ maxSeq: c2 ? c2 - 1 : p2.maxSeq, count: t5.count, conversationID: t5.conversationID, operationID: r3 })).then(function(n3) {
                      function a3() {
                        function a4() {
                          var e4, a5;
                          return o4.messageList = n3.map(Be), s.default.debug("getAdvancedHistoryMessageList with opid: ", r3, "messageList: ", o4.messageList), u3 && i2.set(u3, null != (e4 = null == (a5 = n3[0]) ? void 0 : a5.seq) ? e4 : null), l({}, o4, { isEnd: n3.length < t5.count });
                        }
                        var c4 = (function(t6) {
                          if ((null == (t6 = n3[0]) ? void 0 : t6.sessionType) === exports.SessionType.Group) {
                            var o5 = new Set(n3.map(function(e4) {
                              return e4.sendID;
                            }));
                            return Promise.resolve(e3.groupTrigger.cache.getGroupMembersWithCache({ groupID: n3[0].groupID, userIDList: Array.from(o5), operationID: r3 })).then(function(e4) {
                              n3.forEach(function(t7) {
                                var r4 = e4.find(function(e5) {
                                  return e5.userID === t7.sendID;
                                });
                                r4 && (t7.senderNickname = null == r4 ? void 0 : r4.nickname, t7.senderFaceUrl = null == r4 ? void 0 : r4.faceURL);
                              });
                            });
                          }
                        })();
                        return c4 && c4.then ? c4.then(a4) : a4();
                      }
                      var c3 = (function(o5) {
                        if ((null == (o5 = n3[0]) ? void 0 : o5.sessionType) === exports.SessionType.Single) return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(t5.conversationID, r3)).then(function(t6) {
                          var r4 = e3.userTrigger.cache.getSelfUserInfo();
                          n3.forEach(function(n4) {
                            var o6 = n4.sendID === e3.userID;
                            n4.senderNickname = o6 ? null == r4 ? void 0 : r4.nickname : null == t6 ? void 0 : t6.showName, n4.senderFaceUrl = o6 ? null == r4 ? void 0 : r4.faceURL : null == t6 ? void 0 : t6.faceURL;
                          });
                        });
                      })();
                      return c3 && c3.then ? c3.then(a3) : a3();
                    }) : Promise.resolve(l({}, o4, { isEnd: true }));
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getAdvancedHistoryMessageListReverse: function(t5, r3) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetAdvancedHistoryMessageListReverse, r3, function() {
                  try {
                    var n2 = { isEnd: false, errCode: 0, errMsg: "", messageList: [] };
                    if (!t5.startClientMsgID) return Promise.resolve(l({}, n2, { isEnd: true }));
                    var o4 = e3.messageTrigger.cache.getCachedMessageByClientMsgIDs(t5.conversationID, [t5.startClientMsgID])[0];
                    if (!o4) return Promise.resolve(l({}, n2, { isEnd: true }));
                    var i3 = o4.seq, a3 = e3.messageTrigger.cache.getCachedMaxReadSeq(t5.conversationID);
                    return s.default.log("syncedSeqs", a3), a3 && a3.maxSeq !== i3 ? Promise.resolve(u2({ minSeq: i3, count: t5.count, conversationID: t5.conversationID, operationID: r3 })).then(function(o5) {
                      function i4() {
                        function i5() {
                          return n2.messageList = o5.map(Be), s.default.debug("getAdvancedHistoryMessageListReverse with opid: ", r3, "messageList: ", n2.messageList), l({}, n2, { isEnd: o5.length < t5.count });
                        }
                        var a5 = (function(t6) {
                          if ((null == (t6 = o5[0]) ? void 0 : t6.sessionType) === exports.SessionType.Group) {
                            var n3 = new Set(o5.map(function(e4) {
                              return e4.sendID;
                            }));
                            return Promise.resolve(e3.groupTrigger.cache.getGroupMembersWithCache({ groupID: o5[0].groupID, userIDList: Array.from(n3), operationID: r3 })).then(function(e4) {
                              o5.forEach(function(t7) {
                                var r4 = e4.find(function(e5) {
                                  return e5.userID === t7.sendID;
                                });
                                r4 && (t7.senderNickname = null == r4 ? void 0 : r4.nickname, t7.senderFaceUrl = null == r4 ? void 0 : r4.faceURL);
                              });
                            });
                          }
                        })();
                        return a5 && a5.then ? a5.then(i5) : i5();
                      }
                      var a4 = (function(n3) {
                        if ((null == (n3 = o5[0]) ? void 0 : n3.sessionType) === exports.SessionType.Single) return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(t5.conversationID, r3)).then(function(t6) {
                          var r4 = e3.userTrigger.cache.getSelfUserInfo();
                          o5.forEach(function(n4) {
                            var o6 = n4.sendID === e3.userID;
                            n4.senderNickname = o6 ? null == r4 ? void 0 : r4.nickname : null == t6 ? void 0 : t6.showName, n4.senderFaceUrl = o6 ? null == r4 ? void 0 : r4.faceURL : null == t6 ? void 0 : t6.faceURL;
                          });
                        });
                      })();
                      return a4 && a4.then ? a4.then(i4) : i4();
                    }) : Promise.resolve(l({}, n2, { isEnd: true }));
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, deleteMessage: function(t5, r3) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.DeleteMessage, r3, function() {
                  try {
                    var n2 = e3.messageTrigger.cache.getCachedMessageByClientMsgIDs(t5.conversationID, [t5.clientMsgID])[0], o4 = n2 && e3.messageTrigger.cache.checkIsFilterSeq(t5.conversationID, n2.seq);
                    if (!n2 || o4) throw new le(exports.ErrorCode.ArgsError, "message not exist");
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.DeleteMessage, data: { conversationID: t5.conversationID, seqs: [n2.seq], userID: e3.userID, deleteSyncOpt: void 0, otherSeqs: [] }, operationID: r3 })).then(function() {
                      var o5, i3 = null == (o5 = e3.messageTrigger.cache.getCachedMaxReadSeq(t5.conversationID)) ? void 0 : o5.maxSeq;
                      s.default.debug("delete message with opid: ", r3, "conversationMaxSeq: ", i3, "deleteMessage seq: ", n2.seq), e3.messageTrigger.cache.deleteMessageFromCache(t5.conversationID, n2.seq);
                      var a3 = (function() {
                        if (n2.seq === i3) return Promise.resolve(e3.messageTrigger.getPreviousSeqMessage({ conversationID: t5.conversationID, seq: n2.seq, operationID: r3 })).then(function(n3) {
                          e3.messageTrigger.getOneConversationAndTryChange(t5.conversationID, r3, { latestMsg: n3 ? JSON.stringify(Be(n3)) : "" });
                        });
                      })();
                      if (a3 && a3.then) return a3.then(function() {
                      });
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, deleteAllMsgFromLocalAndSvr: function(t5) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.DeleteAllMsgFromLocalAndSvr, t5, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.DeleteAllMsgFromLocalAndSvr, data: { userID: e3.userID, deleteSyncOpt: void 0 }, operationID: t5 })).then(function() {
                      e3.messageTrigger.cache.getAllCachedConversations().forEach(function(r3) {
                        e3.messageTrigger.getOneConversationAndTryChange(r3.conversationID, t5, { latestMsg: "" });
                      });
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, cancelMessageTasks: function() {
              r2.cancelTasks(), o3.cancelTasks(), t4.clear();
            } };
          })(t3)), Object.assign(t3, /* @__PURE__ */ (function(e3) {
            return { getConversationListSplit: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetConversationListSplit, r2, function() {
                  try {
                    var n2 = e3.messageTrigger.cache.getSortedConversationIDs(t4.offset, t4.count);
                    return Promise.resolve(e3.messageTrigger.getConversationsWithCacheByIDs(n2, r2)).then(ge);
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getOneConversation: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetOneConversation, r2, function() {
                  try {
                    return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(ae(l({}, t4, { userID: e3.userID })), r2)).then(function(n2) {
                      function o3() {
                        return l({}, n2);
                      }
                      var i2 = (function() {
                        if (!n2) return Promise.resolve(e3.messageTrigger.initConversation(l({}, t4, { operationID: r2 }))).then(function(e4) {
                          n2 = e4;
                        });
                      })();
                      return i2 && i2.then ? i2.then(o3) : o3();
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getTotalUnreadMsgCount: function(t4) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.GetTotalUnreadMsgCount, t4, function() {
                  return Promise.resolve(e3.messageTrigger.cache.getTotalUnreadCount());
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, markConversationMessageAsRead: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.MarkConversationMessageAsRead, r2, function() {
                  try {
                    var n2 = e3.messageTrigger.cache.getCachedMaxReadSeq(t4);
                    if (!n2) throw new le(exports.ErrorCode.ArgsError, "conversation not exist");
                    if (n2.hasReadSeq === n2.maxSeq) throw new le(exports.ErrorCode.ArgsError, "hasReadSeq equal max");
                    for (var o3 = [], i2 = n2.hasReadSeq; i2 <= n2.maxSeq; i2++) o3.push(i2);
                    return Promise.resolve(e3.messageTrigger.getMessageWithCacheBySeqs(t4, o3, r2)).then(function(o4) {
                      var i3 = o4.messages, a2 = i3.filter(function(t5) {
                        return t5.sendID !== e3.userID && !t5.isRead;
                      }).map(function(e4) {
                        return e4.seq;
                      });
                      return a2.length || s.default.warn("seqs is empty ", t4), Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.MarkConversationMessageAsRead, data: { conversationID: t4, seqs: a2, hasReadSeq: n2.maxSeq, userID: e3.userID }, operationID: r2 })).then(function() {
                        if (e3.messageTrigger.cache.updateCachedMaxReadSeq(t4, { hasReadSeq: n2.maxSeq }), e3.messageTrigger.cache.markCachedMessagesAsRead(t4), s.default.debug("markConversationMessageAsRead with opid: ", r2, "conversationID: ", t4, "asReadSeqs: ", a2, "syncedMaxSeq", n2.maxSeq), a2.sort()[a2.length - 1] === n2.maxSeq) {
                          var o5 = i3.find(function(e4) {
                            return e4.seq === n2.maxSeq;
                          });
                          o5.isRead = true, e3.messageTrigger.getOneConversationAndTryChange(t4, r2, { latestMsg: JSON.stringify(Be(o5)) });
                        }
                        e3.messageTrigger.getOneConversationAndTryChange(t4, r2).then(function(n3) {
                          e3.messageTrigger.cache.decreaseTotalUnreadCount(n3.unreadCount, r2), e3.messageTrigger.getOneConversationAndTryChange(t4, r2, { unreadCount: 0 });
                        });
                      });
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, deleteConversationAndDeleteAllMsg: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.DeleteConversationAndDeleteAllMsg, r2, function() {
                  try {
                    return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.DeleteConversationAndDeleteAllMsg, data: { conversationIDs: [t4], userID: e3.userID, deleteSyncOpt: void 0 }, operationID: r2 })).then(function() {
                      e3.messageTrigger.cache.clearCachedConversationMessages(t4);
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, setConversation: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.SetConversation, r2, function() {
                  try {
                    return Promise.resolve(e3.messageTrigger.getOneConversationAndTryChange(t4.conversationID, r2)).then(function(n2) {
                      if (!n2) throw new le(exports.ErrorCode.ArgsError, "conversation not exist");
                      return Promise.resolve(e3.sendHttpRequest({ reqFuncName: exports.RequestApi.SetConversation, data: { conversation: l({}, t4, { conversationID: n2.conversationID, conversationType: n2.conversationType, userID: n2.userID, groupID: n2.groupID, attachedInfo: void 0, minSeq: void 0 }), userIDs: [e3.userID] }, operationID: r2 })).then(function() {
                      });
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, changeInputStates: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.ChangeInputStates, r2, function() {
                  try {
                    return Promise.resolve(e3.messageTrigger.typingManager.changeInputStates(l({}, t4, { operationID: r2 }))).then(function() {
                    });
                  } catch (e4) {
                    return Promise.reject(e4);
                  }
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            }, getInputStates: function(t4, r2) {
              try {
                return Promise.resolve(fe(e3.loginStatus, exports.RequestApi.ChangeInputStates, r2, function() {
                  return Promise.resolve(e3.messageTrigger.typingManager.getInputStates(t4.conversationID, t4.userID));
                }));
              } catch (e4) {
                return Promise.reject(e4);
              }
            } };
          })(t3)), t3;
        }
        return v(t2, e2), t2;
      })(Oe);
      var kt = /* @__PURE__ */ (function() {
        function e2() {
        }
        return e2.prototype.then = function(t2, r2) {
          const n2 = new e2(), o2 = this.s;
          if (o2) {
            const e3 = 1 & o2 ? t2 : r2;
            if (e3) {
              try {
                Ot(n2, 1, e3(this.v));
              } catch (e4) {
                Ot(n2, 2, e4);
              }
              return n2;
            }
            return this;
          }
          return this.o = function(e3) {
            try {
              const o3 = e3.v;
              1 & e3.s ? Ot(n2, 1, t2 ? t2(o3) : o3) : r2 ? Ot(n2, 1, r2(o3)) : Ot(n2, 2, o3);
            } catch (e4) {
              Ot(n2, 2, e4);
            }
          }, n2;
        }, e2;
      })();
      function Lt(e2) {
        return e2 instanceof kt && 1 & e2.s;
      }
      function jt(e2, t2, r2) {
        for (var n2; ; ) {
          var o2 = e2();
          if (Lt(o2) && (o2 = o2.v), !o2) return i2;
          if (o2.then) {
            n2 = 0;
            break;
          }
          var i2 = r2();
          if (i2 && i2.then) {
            if (!Lt(i2)) {
              n2 = 1;
              break;
            }
            i2 = i2.s;
          }
          if (t2) {
            var s2 = t2();
            if (s2 && s2.then && !Lt(s2)) {
              n2 = 2;
              break;
            }
          }
        }
        var a2 = new kt(), u2 = Ot.bind(null, a2, 2);
        return (0 === n2 ? o2.then(d2) : 1 === n2 ? i2.then(c2) : s2.then(p2)).then(void 0, u2), a2;
        function c2(n3) {
          i2 = n3;
          do {
            if (t2 && (s2 = t2()) && s2.then && !Lt(s2)) return void s2.then(p2).then(void 0, u2);
            if (!(o2 = e2()) || Lt(o2) && !o2.v) return void Ot(a2, 1, i2);
            if (o2.then) return void o2.then(d2).then(void 0, u2);
            Lt(i2 = r2()) && (i2 = i2.v);
          } while (!i2 || !i2.then);
          i2.then(c2).then(void 0, u2);
        }
        function d2(e3) {
          e3 ? (i2 = r2()) && i2.then ? i2.then(c2).then(void 0, u2) : c2(i2) : Ot(a2, 1, i2);
        }
        function p2() {
          (o2 = e2()) ? o2.then ? o2.then(d2).then(void 0, u2) : d2(o2) : Ot(a2, 1, i2);
        }
      }
      exports.WsErrorEventMap = ne, exports.getSDK = function() {
        return console.info("%cOpenIMSDK v3.8.3-patch.1", "background: #004085; color: #ffffff; padding: 2px 5px; border-radius: 4px;"), new Proxy(new Ft(), { get: function(e2, t2, r2) {
          if ("on" === t2 || "off" === t2) return Reflect.get(e2, t2, r2);
          var n2 = e2[t2];
          return "function" == typeof n2 ? function() {
            try {
              var r3 = [].slice.call(arguments);
              return r3.push(oe()), (function(e3, t3) {
                s.default.debug("%cSDK =>%c [OperationID:" + t3[t3.length - 1] + "] (invoked) run " + e3 + " with args " + JSON.stringify(t3), "font-size:14px; background:#007BFF; border-radius:4px; padding-inline:4px;", "");
              })(t2, r3), Promise.resolve(n2.apply(e2, r3)).then(function(e3) {
                var r4, n3;
                return r4 = t2, (n3 = e3).errCode ? s.default.debug("%cSDK =>%c [OperationID:" + n3.operationID + "] (response) run " + r4 + " with error " + JSON.stringify(n3), "font-size:14px; background:#28A745; border-radius:4px; padding-inline:4px;", "") : s.default.debug("%cSDK =>%c [OperationID:" + n3.operationID + "] (response) run " + r4 + " with response before processor " + JSON.stringify(n3.data), "font-size:14px; background:#FFDC19; border-radius:4px; padding-inline:4px;", ""), e3.errCode ? Promise.reject(e3) : e3;
              });
            } catch (e3) {
              return Promise.reject(e3);
            }
          } : Reflect.get(e2, t2, r2);
        } });
      };
    }
  });

  // src/sdk-entry.js
  var { getSDK, CbEvents } = require_lib2();
  window.OpenIMSDK = { getSDK, CbEvents };
})();
