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
	self._replaceWriteCalled = false

	self.source = pullDefer.source()
	self._sinkRead = pullDefer.source()
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
		self._queue(msg)
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
			return self.underlyingSource.source(end)
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

	// we don't want to actually replace the underlyingSink
	// until all data has been sent to the old underlyingSink
	let actuallyReplaceWrite = function () {
		// called when underlyingSink wants data
		self.underlyingSink.sink(function (end, cb) {
			if (end) {
				return self._sinkRead(end)
			}

			if (self._extraMessage) {
				let message = self._extraMessage
				self._extraMessage = null
				return cb(null, message)
			}

			if (self._replaceWriteCalled) {
				self._replaceWriteCalled = false
				cb(true)
				return actuallyReplaceWrite()
			}

			self._sinkRead(null, function (end, data) {
				if (end) return cb(end)

				let header = new Buffer(5)
				header[0] = DATA_BLOCK
				header.writeUInt32BE(data.length, 1)

				cb(null, Buffer.concat([header, data]))
			})
		})
	}

	if (self.underlyingSink) {
		self.underlyingSink = self._newStream
		self._replaceWriteCalled = true
		let msg = new Buffer(1)
		msg[0] = REPLACE_READ
		self._queue(msg)
	} else {
		self.underlyingSink = self._newStream
		actuallyReplaceWrite()
	}

	self._gotReplaceWrite = false
}

MovableStream.prototype._replaceRead = function () {
	let self = this

	self.underlyingSource = self._newStream
	self._newStream = null
	self.emit('moved', self.underlyingSource)
}

MovableStream.prototype._queue = function (buffer) {
	let self = this

	if (self._extraMessage)
		self._extraMessage = Buffer.concat([self._extraMessage, buffer])
	else
		self._extraMessage = buffer
}
