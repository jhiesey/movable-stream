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
	header.writeUInt8(REPLACE_WRITE, 0)
	self._out.push(header)

	if (self._gotReplaceWrite)
		self._moveWrite()
}

MovableStream.prototype._moveWrite = function () {
	const self = this

	// if actually moving
	if (self._out) {
		// send replaceRead
		console.log('SENDING REPLACE_READ')
		const header = new Buffer(1)
		header.writeUInt8(REPLACE_READ, 0)
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
	self.underlying = self._movingTo
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
		console.log('BLAH')
		self.emit('moved')
	}
}

MovableStream.prototype._outFilter = function (stream, chunk, enc, cb) {
	const self = this

	// Add 5 bytes
	const header = new Buffer(5)
	header.writeUInt8(DATA_BLOCK, 0)
	header.writeUInt32BE(chunk.length, 1)
	stream.push(header)
	stream.push(chunk)
	console.log('SENDING', header)
	console.log('SENDING', chunk)

	cb()
}

MovableStream.prototype._inFilter = function (stream, chunk, enc, cb) {
	const self = this

	let runno = Math.random()

	self._foobar = self._foobar || Math.random()

	console.log(runno, 'RECEIVING', chunk, self._foobar)

	// let origcb = cb
	// cb = function (arg) {
	// 	process.nextTick(function () {
	// 		origcb(arg)
	// 	})
	// }

	console.log(runno, 'IN DATA:', self._inData, self._foobar)

	if (self._inData)
		self._inData = Buffer.concat([self._inData, chunk])
	else
		self._inData = chunk

	console.log(runno, 'FULL BUF', self._inData)

	while (true) {
		console.log(runno, 'tol')
		if (!self._inData || !self._inData.length) {
			self._inData = null
			console.log(runno, 'CLEARED IN DATA 1')
			cb()
			return
		}

		const msgType = self._inData.readUInt8(0)
		console.log(runno, 'MSG TYPE:', msgType)
		switch(msgType) {
			case DATA_BLOCK:
				if (self._inData.length < 5) {
					console.log(runno, 'SHORT RETURN 1')
					cb()
					return
				}
				const len = self._inData.readUInt32BE(1)
				if (self._inData.length < len + 5) {
					console.log(runno, 'SHORT RETURN 2', self._inData, self._foobar)
					cb()
					return
				}
				let chunk = self._inData.slice(5, len + 5)
				console.log('RECEIVING', chunk)
				self._inData = self._inData.slice(len + 5)
				stream.push(chunk)
				break

			case REPLACE_WRITE:
				self._inData = self._inData.slice(1)
				self._gotReplaceWrite = true
				if (self._movingTo)
					self._moveWrite()
				break

			case REPLACE_READ:
				console.log('GOT REPLACE_READ')
				self._inData = self._inData.slice(1)
				// This should always be the last data on this stream
				if (self._inData.length !== 0)
					console.error('BADBADBADBADBADBADBADBADBAD****************************************')
				// console.log(runno, 'CLEARED IN DATA 2')
				self._moveRead()
				cb()
				return

			default:
				self._inData = null
				console.log(runno, 'CLEARED IN DATA 3')
				cb(new Error('Unexpected message type:', msgType))
				return
		}
	}
}
