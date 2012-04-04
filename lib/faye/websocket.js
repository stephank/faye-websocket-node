// API and protocol references:
// 
// * http://dev.w3.org/html5/websockets/
// * http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#interface-eventtarget
// * http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#interface-event
// * http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-75
// * http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-76
// * http://tools.ietf.org/html/draft-ietf-hybi-thewebsocketprotocol-17

var Draft75Parser = require('./websocket/draft75_parser'),
    Draft76Parser = require('./websocket/draft76_parser'),
    HybiParser    = require('./websocket/hybi_parser'),
    API           = require('./websocket/api'),
    Event         = require('./websocket/api/event');

var getParser = function(request) {
  var headers = request.headers;
  return headers['sec-websocket-version']
       ? HybiParser
       : (headers['sec-websocket-key1'] && headers['sec-websocket-key2'])
       ? Draft76Parser
       : Draft75Parser;
};

var isSecureConnection = function(request) {
  if (request.headers['x-forwarded-proto']) {
    return request.headers['x-forwarded-proto'] === 'https';
  } else {
    return (request.connection && request.connection.authorized !== undefined) ||
           (request.socket && request.socket.secure);
  }
};

var WebSocket = function(request, response, supportedProtos, options) {
  var self = this;

  this.request = request;
  this._ping   = options && options.ping;
  this._pingId = 0;
  this._sendBuffer = [];
  
  var scheme = isSecureConnection(request) ? 'wss:' : 'ws:';
  this.url = scheme + '//' + request.headers.host + request.url;
  this.readyState = API.CONNECTING;
  this.bufferedAmount = 0;
  
  var Parser = getParser(request);
  this._parser = new Parser(this, {protocols: supportedProtos});
  
  this._parser.writeResponseHead(response);
  
  this.protocol = self._parser.protocol || '';
  this.version = self._parser.getVersion();
  
  response.switchProtocols(function(socket) {
    self._stream = socket;
    self._stream.setTimeout(0);
    self._stream.setNoDelay(true);
    
    self._stream.addListener('data', function(data) {
      var reply = self._parser.parse(data);
      if (!reply) return;
      try { self._stream.write(reply, 'binary') } catch (e) {}
      self._open();
    });
    ['close', 'end', 'error'].forEach(function(event) {
      self._stream.addListener(event, function() {
        self.close(1006, '', false);
      });
    });
    
    if (self._parser.isOpen()) self.readyState = API.OPEN;
    process.nextTick(function() { self._open() });
    
    if (self._ping)
      self._pingLoop = setInterval(function() {
        self._pingId += 1;
        self.ping(self._pingId.toString());
      }, self._ping * 1000);
  });
};

WebSocket.prototype.ping = function(message, callback, context) {
  if (!this._parser.ping) return false;
  return this._parser.ping(message, callback, context);
};

for (var key in API) WebSocket.prototype[key] = API[key];

WebSocket.WebSocket   = WebSocket;
WebSocket.Client      = require('./websocket/client');
WebSocket.EventSource = require('./eventsource');
module.exports        = WebSocket;

