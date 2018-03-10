const pullDefer = require('pull-defer')

const DATA_BLOCK = 0
const INJECTED_BLOCK = 1
const DATA_END = 2

const noop = function () {}

module.exports = function (initialStream, name) {
	let s = pullDefer.source()
	let sourceCb = null
	// let ignoreEnd = false
	let dataRequested = false
	let aborted = null
	let ended = false
	let queue = [] // can contain Buffers and {stream:<stream>, err:<error>}
	let destination = null // current target stream

	let sink = function (realRead) {
		let read = function (end, realCb) {
			console.log(name, 'INJECTOR READ', end)
			// if (end || global.startMagic2) {
			// 	console.log('BEGIN STACK')
			// 	console.log(new Error().stack)
			// 	console.log('END STACK')
			// }
			let cb = function (e, d) {
				console.log(name, 'INJECTOR READ CB', e, d)
				// if (global.startMagic2) {
				// 	console.log('BEGIN STACK')
				// 	console.log(new Error().stack)
				// 	console.log('END STACK')
				// }
				realCb(e, d)
			}
			// console.log(name, '* injector calling read')
			realRead(end, cb)
			// console.log(name, '* injector called read')
		}

		s.resolve(read)
	}

	let replace = function (stream) {
		console.log(name, 'INJECTOR REPLACE')
		destination = stream
		// dataRequested = false
		stream(function (end, cb) {
			// console.log(name, 'PULL FROM INJECTOR', end, 'dataRequested:', dataRequested, 'aborted:', aborted, 'ended:', ended, 'queue:', queue)
			// let cb = function (e, d) {
			// 	console.log(name, 'PULL FROM INJECTOR CB', e, d)
			// 	realCb(e, d)
			// }

			// called when data wants to go through
			if (aborted)
				return cb(aborted)
			if (stream !== destination) {
				console.log(name, 'INJECTOR PULL FROM OLD STREAM, ENDING')
				// we've switched away from this stream. End it.
				return cb(true)
			}
			console.log(name, 'CURRENT STREAM PULL FROM INJECTOR')

			if (end) {
				console.log(name, 'INJECTOR DESTINATION ENDED')
				// if (ignoreEnd) {
				// 	// console.log('ignoring end')
				// 	// console.log('clearing ignoreEnd')
				// 	ignoreEnd = false
				// } else {
				// 	console.log(name, 'not ignoring end')
				// 	s(end, cb)
				// }
				// return
				// return cb(end) // SHOULD ALSO SWITCH

				if (queue.length === 0) {
					console.log('IGNORING LATE END')
					cb(true)
				} else if (queue.length === 1 && !Buffer.isBuffer(queue[0])) {
					console.log('IGNORING SIMULTANEOUS END')
					pushOut(cb)
				} else {
					console.log('WTF WRONG', queue)
					s(end, cb)
				}

				return
			}

			// if we have something to send, send it
			if (queue.length)
				return pushOut(cb)

			sourceCb = cb
			if (dataRequested || ended)
				return

			// otherwise try to pull more data in
			dataRequested = true
			// console.log('INJECTOR PULLING')
			s(null, function (end, data) {
				console.log(name, 'INJECTOR', end, data)
				// if (end) {
				// 	console.log('BEGIN STACK')
				// 	console.log(new Error().stack)
				// 	console.log('END STACK')
				// }
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
			if (queue[0] && queue[0].stream) { // if it's defined, queue[0] is not a buffer
				// console.log('setting ignoreEnd')
				// ignoreEnd = true
			}

			return cb(null, b)
		}

		// console.log('INJECTOR ending underlying stream')
		const elem = queue[0]
		queue.splice(0, 1)
		cb(elem.err || true)
		if (elem.stream)
			replace(elem.stream)
	}

	sink.inject = function (buf) {
		sink.injectAndSwitch(buf, null)
	}

	sink.injectAndSwitch = function (buf, stream) {
		let header = new Buffer(5)
		header[0] = INJECTED_BLOCK
		header.writeUInt32BE(buf.length, 1)
		if (stream) {
			queueOut([header, buf, {stream: stream}])
		}
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
