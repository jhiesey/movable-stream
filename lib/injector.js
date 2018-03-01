const pullDefer = require('pull-defer')

const DATA_BLOCK = 0
const INJECTED_BLOCK = 1
const DATA_END = 2

const noop = function () {}

module.exports = function (initialStream) {
	let s = pullDefer.source()
	let sourceCb = null
	let ignoreEnd = false
	let dataRequested = false
	let aborted = null
	let ended = false
	let queue = [] // can contain Buffers and {stream:<stream>, err:<error>}

	let sink = function (read) {
		s.resolve(read)
	}

	let replace = function (stream) {
		stream(function (end, cb) {
			// called when data wants to go through
			if (aborted)
				return cb(aborted)
			if (end) {
				if (ignoreEnd) {
					ignoreEnd = false
				} else {
					s(end, noop)
				}
				return cb(end)
			}

			// if we have something to send, send it
			if (queue.length)
				return pushOut(cb)

			sourceCb = cb
			if (dataRequested || ended)
				return

			// otherwise try to pull more data in
			dataRequested = true
			s(null, function (end, data) {
				dataRequested = false
				if (end) {
					ended = true
					let header = new Buffer(1)
					header[0] = DATA_END
					if (end === true)
						queueOut([header])
					else
						queueOut([{err: end}])
					return
				}

				let header = new Buffer(5)
				header[0] = DATA_BLOCK
				header.writeUInt32BE(data.length, 1)

				queueOut([header, data])
			})
		})
	}

	let queueOut = function (stuff) {
		queue.push.apply(queue, stuff)

		if (sourceCb) {
			const cb = sourceCb
			sourceCb = null
			pushOut(cb)
		}
	}

	let pushOut = function (cb) {
		if (aborted)
			return cb(aborted, noop)

		// precondition: queue is not empty
		if (Buffer.isBuffer(queue[0])) {
			let lastBuffer = 0
			while (lastBuffer < queue.length && Buffer.isBuffer(queue[lastBuffer]))
				lastBuffer++

			let b = Buffer.concat(queue.slice(0, lastBuffer))
			queue.splice(0, lastBuffer)
			return cb(null, b)
		}

		cb(queue[0].err || true)
		ignoreEnd = true
		if (queue[0].stream)
			replace(queue[0].stream)
		queue.splice(0, 1)
	}

	sink.inject = function (buf) {
		sink.injectAndSwitch(buf, null)
	}

	sink.injectAndSwitch = function (buf, stream) {
		let header = new Buffer(5)
		header[0] = INJECTED_BLOCK
		header.writeUInt32BE(buf.length, 1)
		if (stream)
			queueOut([header, buf, {stream: stream}])
		else
			queueOut([header, buf])
	}

	sink.abort = function (err) {
		if (aborted)
			return
		aborted = err || true
		if (!ended)
			s(aborted, noop)
		if (sourceCb)
			sourceCb(aborted)
	}

	replace(initialStream)

	return sink
}
