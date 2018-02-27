const inherits = require('inherits')
const EventEmitter = require('events')
const pull = require('pull-stream')
const pullDefer = require('pull-defer')

const DATA_BLOCK = 0
const REPLACE_WRITE = 1
const REPLACE_READ = 2

const MovableStream = module.exports = function (initialStream) {
	if (!(this instanceof MovableStream)) return new MovableStream(initialStream)
	let self = this

	self.underlyingSource = null
	self.underlyingSink = null
	self._inBuffer = null
	self._newStream = null
	self._sinkResolved = false
	self._gotReplaceWrite = false
	self._outBuffer = null
	self._outEnd = null
	self._runReplaceWrite = false
	self._ignoreInEnd = false

	self._sinkRead = pullDefer.source()
	self.source = pullDefer.source()
	self.sink = function (read) {
		self._sinkRead.resolve(read)
	}

	if (initialStream)
		self.moveto(initialStream)
}

inherits(MovableStream, EventEmitter)

MovableStream.prototype.moveto = function (newStream) {
	let self = this

	// queue up calls if move in progress
	if (self._newStream)
		return self.once('moved', self.moveto.bind(self, newStream))

	self._newStream = newStream
	if (self.underlyingSink) {
		// actually moving
		let msg = new Buffer(1)
		msg[0] = REPLACE_WRITE
		self._queueOut(null, msg)
		if (self._gotReplaceWrite)
			self._replaceWrite()
	} else {
		self.underlyingSource = newStream
		self._start()
		self._newStream = null
	}
}

MovableStream.prototype._start = function () {
	let self = this
	// called whenever data wanted from the wire
	self.source.resolve(function (end, cb) {
		if (end) {
			return self.underlyingSource.source(end, cb)
		}

		const bufferData = function (end, data) {
			if (end)
				return cb(end)

			if (self._inBuffer)
				self._inBuffer = Buffer.concat([self._inBuffer, data])
			else
				self._inBuffer = data
			haveData()
		}

		const haveData = function () {
			while (true) {
				const msgType = self._inBuffer[0]
				switch(msgType) {
					case DATA_BLOCK:
						if (self._inBuffer.length < 5)
							return self.underlyingSource.source(null, bufferData)
						const len = self._inBuffer.readUInt32BE(1)
						if (self._inBuffer.length < len + 5)
							return self.underlyingSource.source(null, bufferData)

						const chunk = self._inBuffer.slice(5, len + 5)
						if (self._inBuffer.length === len + 5)
							self._inBuffer = null
						else
							self._inBuffer = self._inBuffer.slice(len + 5)
						return cb(null, chunk)
					case REPLACE_WRITE:
						self._gotReplaceWrite = true
						self._inBuffer = self._inBuffer.slice(1)
						if (self._newStream)
							self._replaceWrite()
						break
					case REPLACE_READ:
						self._inBuffer = self._inBuffer.slice(1)
						if (self._inBuffer.length)
							throw new Error('unexpected data after REPLACE_READ')
						self._replaceRead()
						break
					default:
						throw new Error('unexpected byte in MovableStream')
				}

				if (self._inBuffer.length === 0) {
					self._inBuffer = null
					return self.underlyingSource.source(null, bufferData)
				}
			}
		}

		if (!self._inBuffer)
			self.underlyingSource.source(null, bufferData)
		else
			haveData()
	})

	self._replaceWrite()
}

MovableStream.prototype._replaceWrite = function () {
	let self = this

	if (self.underlyingSink) {
		self.underlyingSink = self._newStream
		self._runReplaceWrite = true
		self._ignoreInEnd = true
		let msg = new Buffer(1)
		msg[0] = REPLACE_READ
		self._queueOut(null, msg)
		self._queueOut(true)
	} else {
		self.underlyingSink = self._newStream
		self._actuallyReplaceWrite()
	}

	self._gotReplaceWrite = false
}

MovableStream.prototype._actuallyReplaceWrite = function () {
	let self = this
	// we don't want to actually replace the underlyingSink
	// until all data has been sent to the old underlyingSink
	self.underlyingSink.sink(function (end, cb) {
		// called when data needed to go out
		if (end) {
			if (self._ignoreInEnd) {
				self._ignoreInEnd = false
			} else {
				self._sinkRead(end, cb)
			}
		}

		// if we have something to send, send it
		if (self._outBuffer || self._outEnd) {
			return self._pushOut(cb)
		}

		// otherwise try to pull more data in
		self._outCb = cb
		self._requestOutData()
	})
}

MovableStream.prototype._replaceRead = function () {
	let self = this

	self.underlyingSource = self._newStream
	self._newStream = null
	self.emit('moved', self.underlyingSource)
}

MovableStream.prototype._requestOutData = function () {
	let self = this

	if (self._outDataRequested)
		return

	self._outDataRequested = true
	self._sinkRead(null, function (end, data) {
		self._outDataRequested = false
		if (end) {
			return self._queueOut(end)
		}

		let header = new Buffer(5)
		header[0] = DATA_BLOCK
		header.writeUInt32BE(data.length, 1)

		self._queueOut(null, Buffer.concat([header, data]))
	})
}

MovableStream.prototype._queueOut = function (end, buffer) {
	let self = this

	if (end) {
		self._outEnd = end
	} else { // buffer must be set
		if (self._outBuffer) {
			self._outBuffer = Buffer.concat([self._outBuffer, buffer])
		}
		else
			self._outBuffer = buffer
	}

	if (self._outCb) {
		const cb = self._outCb
		self._outCb = null
		self._pushOut(cb)
	}
}

MovableStream.prototype._pushOut = function (cb) {
	let self = this

	if (self._outBuffer) {
		const buffer = self._outBuffer
		self._outBuffer = null
		return cb(null, buffer)
	}

	const end = self._outEnd
	if (!end) throw new Error('bad stream state')
	self._outEnd = null
	cb(end)
	if (self._runReplaceWrite) {
		self._runReplaceWrite = false
		self._actuallyReplaceWrite()
	}
}
