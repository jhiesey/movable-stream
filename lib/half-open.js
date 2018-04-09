const noop = function () {}

/*
Wraps a stream so that ending one half (source or sink) locally
won't end the other immediately. Instead, closing the other half
is delayed until BOTH ends are closed locally. End events from
the remote end still pass through immediately.
*/
module.exports = function (duplex) {
	let sourceEnd = null
	let sinkEnd = null
	let triggerSink = function () {
		if (sinkEnd && sinkEnd !== true)
			sinkEnd()
	}
	let triggerSource = function () {
		if (sourceEnd && sourceEnd !== true)
			sourceEnd()
	}

	return {
		source: function (end, origCb) {
			let cb = function (end, data) {
				origCb(end, data)
				if (end) {
					sourceEnd = true
					triggerSink()
				}
			}

			if (end) {
				if (sinkEnd) {
					duplex.source(end, cb)
					triggerSink()
				} else {				
					sourceEnd = duplex.source.bind(null, end, noop)
					cb(end)
				}
			} else {
				duplex.source(null, cb)
			}
		},
		sink: function (read) {
			duplex.sink(function (end, origCb) {
				let cb = function (end, data) {
					if (end) {
						if (sourceEnd) {
							origCb(end)
							triggerSource()
						} else {
							sinkEnd = origCb.bind(null, end)
						}
					} else {
						origCb(null, data)
					}
				}

				if (end) {
					sinkEnd = true
					triggerSource()
				}
				read(end, cb)
			})
		}
	}
}