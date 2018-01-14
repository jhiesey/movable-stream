const duplexify = require('duplexify')
const inherits = require('inherits')
const pump = require('pump')
const through2 = require('through2')

const DATA_BLOCK = 0
const REPLACE_WRITE = 1
const REPLACE_READ = 2

const MovableStream = module.exports = function (initialStream) {
	const self = this
	duplexify.call(self)

	self._inBuffer = null

	if (initialStream)
		self.moveto(initialStream)
}

inherits(MovableStream, duplexify)

MovableStream.prototype.moveto = function (newStream) {
	const self = this

	self._movingTo = newStream

	if (!self._out) {
		self._moveWrite()
		self._moveRead()
		return
	}

	// send replaceWrite
	const header = new Buffer(1)
	header.writeUInt8(REPLACE_WRITE)
	self._out.push(header)

	if (self._gotReplaceWrite)
		self._moveWrite()
}

MovableStream.prototype._moveWrite = function () {
	const self = this

	// if actually moving
	if (self._out) {
		// send replaceRead
		const header = new Buffer(1)
		header.writeUInt8(REPLACE_READ)
		self._out.push(header)
	}

	self._out = through2(function (chunk, enc, cb) {
		// console.log('pushing')
		self._outFilter(this, chunk, enc, cb)
	})

	self._movedDuplex = duplexify()
	self._movedDuplex.setReadable(self._out)
	const currWritable = self._movingTo
	pump(self._movedDuplex, self._movingTo, self._movedDuplex, function (err) {
		if (currWritable === self._currWritable)
			self.destroy(err)
	})

	// console.log('changing to new stream')
	self.setWritable(self._out)
	self._currWritable = self._movingTo

	self._gotReplaceWrite = false
	self._movingTo = null
}

MovableStream.prototype._moveRead = function () {
	const self = this
	const actuallyMoving = !!self._in
	self._in = through2(function (chunk, enc, cb) {
		self._inFilter(this, chunk, enc, cb)
	})

	self._movedDuplex.setWritable(self._in)
	self.setReadable(self._in)

	if (actuallyMoving) {
		self.emit('moved')
	}
}

MovableStream.prototype._outFilter = function (stream, chunk, enc, cb) {
	const self = this

	// Add 5 bytes
	const header = new Buffer(5)
	header.writeUInt8(0, DATA_BLOCK)
	header.writeUInt32BE(chunk.length, 1)
	stream.push(header)
	stream.push(chunk)

	cb()
}

MovableStream.prototype._inFilter = function (stream, chunk, enc, cb) {
	const self = this

	let buf
	if (self._inData)
		buf = Buffer.concat([self._inData, chunk])
	else
		buf = chunk

	while (true) {
		if (buf.length) {
			self._inData = buf
		} else {
			self._inData = null
			cb()
			return
		}

		const msgType = buf.readUInt8(0)
		switch(msgType) {
			case DATA_BLOCK:
				if (buf.length < 5) {
					cb()
					return
				}
				const len = buf.readUInt32BE(1)
				if (buf.length < len + 5) {
					cb()
					return
				}
				stream.push(buf.slice(5, len + 5))
				buf = buf.slice(len + 5)
				break

			case REPLACE_WRITE:
				buf = buf.slice(1)
				self._gotReplaceWrite = true
				if (self._movingTo)
					self._moveWrite()
				break

			case REPLACE_READ:
				self._moveRead()
				// This should always be the last data on this stream
				self._inData = null
				cb()
				return
			default:
				cb(new Error('Unexpected message type:', msgType))
		}
	}
}
