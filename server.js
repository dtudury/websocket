// very helpful: https://medium.com/hackernoon/implementing-a-websocket-server-with-node-js-d9b78ec5ffa8
const http = require('http')
const fs = require('fs')
const crypto = require('crypto')

const PORT = process.env.PORT || 8080
let sockets = []
const history = []
const renderHtml = () => `
<!doctype html>
<html>
<body style="white-space: pre-wrap;">
&lt;meta&gt; + &lt;enter&gt; to send
<textarea type="text"></textarea>${history.map(message => '<hr>' + message).join('\n')}
  <script>
    const textarea = document.querySelector('textarea')
    const url = { 'http:': 'ws:', 'https:': 'wws:' }[window.location.protocol] + '//' + window.location.host
    let ws
    function connect() {
      ws = new WebSocket(url)
      ws.addEventListener('message', e => {
        console.log(e)
        textarea.after(document.createElement('hr'), e.data)
      })
      ws.addEventListener('close', () => {
        setTimeout(connect, 2000)
      })
    }
    connect()
    textarea.addEventListener('keydown', e => {
      if (e.keyCode !== 13 || !e.metaKey) return
      console.log(e.target.value)
      ws.send(e.target.value)
      e.target.value = ''
    })
  </script>
</body>
</html>
`

http.createServer((req, res) => {
  console.log('---')
  ; ['method', 'url', 'headers'].forEach(thing => console.log(thing, req[thing]))
  if (req.headers.connection === 'Upgrade' && req.headers.upgrade === 'websocket') {
    const magic = crypto.createHash('sha1').update(
      Buffer.from(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    ).digest('base64')
    res.socket.write([ 
      'HTTP/1.1 101 Switching Protocols', 
      'Upgrade: websocket', 
      'Connection: Upgrade', 
      `Sec-WebSocket-Accept: ${magic}` 
    ].join('\r\n') + '\r\n\r\n')
    res.socket.on('data', data => {
      const string = unframe(data)
      if (string) {
        console.log(string)
        history.unshift(string)
        while (history.length > 1000) history.pop()
        const framedString = frame(string)
        sockets.forEach(socket => socket.write(framedString))
      }
    })
    res.socket.on('close', error => {
      sockets = sockets.filter(socket => socket !== res.socket)
    })
    sockets.push(res.socket)
  } else if (req.url === '/') {
    res.writeHead(200)
    res.end(renderHtml())
  } else {
    res.writeHead(404)
    res.end('File not found.')
  }
}).listen(PORT)

function unframe(frame) {
  let i = 0
  const fin = frame[i] >>> 7
  const rsv = (frame[i] >>> 4) & 0b111 // not used
  const opcode = frame[i] & 0b1111
  if (opcode !== 1) return // we're only going to handle string data
  ++i
  const mask = frame[i] >>> 7
  let payloadLength = frame[i] & 0b01111111
  ++i
  if (payloadLength === 126) {
    payloadLength = frame[i] * 0x100 + frame[i + 1]
    i += 2
  }
  // not handling the `else if (payloadLength === 127)` (which would mean the payload length needs more than 2 bytes to be represented)
  if (mask) {
    const maskingKey = [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]]
    i += 4
    for (let j = 0; j < payloadLength; ++j) {
      frame[i + j] ^= maskingKey[j % 4]
    }
  }
  return frame.slice(i).toString('utf8')
}

function frame (string) {
  const stringLength = Buffer.byteLength(string)
  const headerLength = stringLength < 126 ? 2 : 4
  const payloadLength = Math.min(stringLength, 126) // <126 means actual length, 126 means length is in next 2 bytes, 127 means next 8 (but we're not doing that now)
  const frame = Buffer.alloc(headerLength + stringLength)
  frame.writeUInt8(0b10000001, 0)
  frame.writeUInt8(payloadLength, 1)
  if (headerLength > 2) {
    frame.writeUInt16BE(stringLength, 2)
  }
  frame.write(string, headerLength)
  return frame
}