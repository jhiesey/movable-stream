const inherits = require('inherits')
const EventEmitter = require('events')
const pull = require('pull-stream')
const pullDefer = require('pull-defer')

const injector = require('./lib/injector')
const extractor = require('./lib/extractor')

const REPLACE_WRITE = 0
const REPLACE_READ = 1

const MovableStream = module.exports = function (initialStream) {
	if (!(this instanceof MovableStream)) return new MovableStream(initialStream)
	let self = this

	if (!initialStream)
		throw new Error('initial stream must be provided')

	self._newStream = null
	self._gotReplaceWrite = false
	self._aborted = false

	self.sink = injector(initialStream.sink)
	self.source = extractor(initialStream.source, function (buf) {
		if (buf.length !== 1) {
			throw new Error('invalid sidechannel message length')
		}

		switch (buf[0]) {
			case REPLACE_READ:
				if (!self._newStream) {
					throw new Error('unexpected REPLACE_READ message')
				}
				let newStream = self._newStream
				self._newStream = null
				self.emit('moved', newStream) // TODO: not really quite the right time?
				return newStream.source

			case REPLACE_WRITE:
				self._gotReplaceWrite = true
				if (self._newStream)
					self._replaceWrite(self._newStream)
				return null
			default:
				throw new Error('invalid sidechannel message')
		}
	})

	// self.source.on('abort', self.abort.bind(self))
}

inherits(MovableStream, EventEmitter)

MovableStream.prototype.moveto = function (newStream) {
	let self = this

	// queue up calls if move in progress
	if (self._newStream)
		return self.once('moved', self.moveto.bind(self, newStream))

	self._newStream = newStream
	self.sink.inject(Buffer.from([REPLACE_WRITE]))
	if (self._gotReplaceWrite)
		self._replaceWrite(newStream)
}

MovableStream.prototype._replaceWrite = function (newStream) {
	let self = this

	self.sink.injectAndSwitch(Buffer.from([REPLACE_READ]), newStream.sink)
	self._gotReplaceWrite = false
}

MovableStream.prototype.abort = function () {
	let self = this

	if (self._aborted) return
	self._aborted = true
	self.sink.abort()
	self.source.abort()
}
