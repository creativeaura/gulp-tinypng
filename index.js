// through2 is a thin wrapper around node transform streams
var through = require('through2');
var prettyBytes = require('pretty-bytes');
var gutil = require('gulp-util');
var mkdirp = require('mkdirp');
var rmdir = require('rmdir');
var request = require('request');
var path = require('path');
var inspect = require('util').inspect;
var fs = require('fs');
var md5 = require('md5');

var PluginError = gutil.PluginError;
var AUTH_TOKEN;

// Consts
const PLUGIN_NAME = 'gulp-tinypng';
const TEMP_DIR = '.gulp/tinypng/';

function prefixStream(prefixText) {
	var stream = through();
	stream.write(prefixText);
	return stream;
}

var createTempDir = function() {
	fs.access('.gulp/tinypng', fs.F_OK, function(err) {
		if (err) {
			mkdirp('.gulp/tinypng', function(err) {
				if (err) {
					console.error('Error creating temp folder');
				}
			});
		}
	});
}

var cleanTemp = function() {
	rmdir('.gulp/tinypng', function(err, dirs, files) {
		mkdirp('.gulp/tinypng', function(err) {
			if (err) {
				console.error('Error creating temp folder');
			}
		});
	});
};

var download = function(uri, filename, complete) {
	request.head(uri, function(err, res, body) {
		request({
				url: uri,
				strictSSL: false
			})
			.pipe(fs.createWriteStream(TEMP_DIR + filename))
			.on('close', function() {
				complete();
			});
	});
};

var readTemp = function(filename, cb) {
	fs.readFile('.gulp/tinypng/' + filename, function(err, data) {
		if (err) {
			return cb(new PluginError('gulp-tinypng', err));
		}
		cb(null, data);
	});
};

// Plugin level function (dealing with files)
function gulpPrefixer(options) {
	var apiKey = options.apiKey;
	var cached = options.cached;
	AUTH_TOKEN = new Buffer('api:' + apiKey).toString('base64')
	if (!apiKey) {
		throw new PluginError(PLUGIN_NAME, "Missing api key!");
	}
	apiKey = new Buffer(apiKey); // allocate ahead of time
	if (!cached) {
		cleanTemp();
	} else {
		createTempDir();
	}
	// Creating a stream through which each file will pass
	var stream = through.obj(function(file, enc, callback) {
		if (file.isNull()) {
			this.push(file); // Do nothing if no contents
			return callback();
		}

		if (file.isBuffer()) {
			var prevLength = file.contents.length;
			tinypng(file, function(data) {
				file.contents = data;
				this.push(file);
				gutil.log('gulp-tinypng: ', gutil.colors.green('✔ ') + file.relative + ' (saved ' +
					prettyBytes(prevLength - data.length) + ' - ' + ((1 - data.length / prevLength) * 100).toFixed(0) + '%)');
				return callback();
			}.bind(this));
		}

		if (file.isStream()) {
			throw new PluginError(PLUGIN_NAME, "Stream is not supported");
			return callback();
		}
	});

	// returning the file stream
	return stream;
};

var tinyNewPng = function(file, cb) {
	request({
		url: 'https://api.tinypng.com/shrink',
		method: 'POST',
		strictSSL: false,
		headers: {
			'Accept': '*/*',
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/x-www-form-urlencoded',
			'Authorization': 'Basic ' + AUTH_TOKEN
		},
		body: file.contents
	}, function(error, response, body) {
		var results, filename;
		if (!error) {
			// filename = path.basename(file.path);
			filename = md5(file.contents);
			results = JSON.parse(body);
			// size
			// ratio
			// url
			if (results.output && results.output.url) {
				download(results.output.url, filename, function() {
					fs.readFile(TEMP_DIR + filename, function(err, data) {
						if (err) {
							gutil.log('[error] :  gulp-tinypng - ', err);
						}
						cb(data);
					});
				});
			} else {
				gutil.log('[error] : gulp-tinypng - ', results.message);
			}
		}
	});
}

function tinypng(file, cb) {
	var tmpFileName = md5(file.contents);
	// console.log(tmpFileName);
	readTemp(tmpFileName, function(err, tmpFile) {
		if (err) {
			tinyNewPng(file, function(data) {
				cb(data);
			})
		} else {
			cb(tmpFile);
		}
	})

};
// Exporting the plugin main function
module.exports = gulpPrefixer;
