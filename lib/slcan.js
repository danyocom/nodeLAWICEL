/**
 * @file slcan.js
 * @namespace canbus
 * Module for interfacing with serial line CAN (slcan) devices
 */
const SerialPort = require('serialport');
const parsers = SerialPort.parsers;

const CMD_OPEN_BUS = 'O\r';

var frame = require("./frame");

/**
 * @module slcan
 */

/**
 * Defines a serial line CAN (slcan) interface.
 * @class slcan
 * @constructor
 * @param {String} dev_str Path to, or name of serial device
 * @param {Integer} speed Speed setting to use (0-8)
 * @param {Function} recvFrameCallback Callback function to call when frame is
 * received
 */
function slcan(dev_str, speed, recvFrameCallback) {
    this._dev_str = dev_str;
    this._speed = speed;
    this._conn = null;

    // variables to hold the incomming string until it terminates
    this._recv_count = 0;
    this._recv_str = "";
    this._lastCMD = null;
    /**
     * Callback function to fire when frame is received
     * @property recvFrameCallback
     * @type Function
     */
    this.recvFrameCallback = recvFrameCallback;
}

/**
 * Length in characters of a standard CAN identifier
 * @property STD_ID_LEN
 * @type Number
 * @final
 */
slcan.STD_ID_LEN = 3;

/**
 * Length in characters of an extended CAN identifier
 * @property EXT_ID_LEN
 * @type Number
 * @final
 */
slcan.EXT_ID_LEN = 8;

/**
 * Open a connection to the serial device
 * @method open
 */
slcan.prototype.open = function() {
    //this._conn = new SerialPort(this._dev_str, {parser: serialport.parsers.readline("\r")});
    this._conn = new SerialPort(this._dev_str);
    // Use a `\r\n` as a line terminator
    this._parser = new parsers.Readline({delimiter: '\r'});
    this._conn.pipe(this._parser);

    this._conn.on("open", this._serialOpenCallback.bind(this));
    //this._conn.on("data", this._serialRecvCallback.bind(this));
    this._parser.on("data", this._serialRecvCallback.bind(this));
}

/**
 * Send a CAN frame
 * @method send
 * @param {canbus.frame} frame Frame to send
 */
slcan.prototype.send = function(frame) {
    // ensure that we have a connection to the device
    if (!this._conn) {
        throw "Not connected to serial device";
    }

    // convert frame to slcan string
    var slcan_str = this._packFrame(frame);
    this._serialWrite(slcan_str);

}

/**
 * Send a string on the serial port
 * @param {String} str String to send
 * @private
 */
slcan.prototype._serialWrite = function(str) {
    // send to serial device
    this._lastCMD =  str;
    this._conn.write(str, function(e){});
}

/**
 * Callback for serial port opening
 * @method _serialOpenCallback
 * @param conn Connection that was opened
 * @private
 */
slcan.prototype._serialOpenCallback = function() {
    console.log('connected to device ' + this._dev_str);
    this._conn.flush();

    // open can communication
    this._serialWrite("S" + this._speed + "\r");
    this._serialWrite("O\r");
}

/**
 * Callback for parsing received data from the serial port
 * @method _serialRecvCallback
 * @param received Data received from serial port
 * @private
 */
slcan.prototype._serialRecvCallback = function(data) {
    // convert string to frame
    try{
        var frame = this._parseFrame(data);
        // set the timestamp
        frame.timestamp = Date.now();
        // call the handler
        this.recvFrameCallback(frame);
    }
    catch(err){
        console.log(err);
    }
}

/**
 * Helper function to parse a slcan string into a canbus.frame object
 * @method slcan._parseFrame
 * @param {String} str String to parse into frame
 * @private
 */
slcan.prototype._parseFrame = function(str) {
    var is_ext_id;
    var is_remote;
    var id;
    var dlc;
    var data = []


    // get frame type from first character
    if (str[0] === 't') {
        is_ext_id = false;
        is_remote = false;
    } else if (str[0] === 'r') {
        is_ext_id = false;
        is_remote = true;
    } else if (str[0] === 'T') {
        is_ext_id = true;
        is_remote = false;
    } else if (str[0] === 'R') {
        is_ext_id = true;
        is_remote = true;
    } else if (str[0].charCodeAt(0) === 7) {
        if(this._lastCMD == CMD_OPEN_BUS){
            throw "Open Failed! (Bus already open?)";
        }
    } else {

        var debugStr = '-> ascii: \''+str+'\'   char_codes: ';
        for(var i=0; i<str.length;i++){
            debugStr  += '['+str.charCodeAt(i)+']';
        }
        throw "Invalid slcand frame! (bad frame type char) " + debugStr + '\r\n';
    }

    // slice the correct number of bits depending on id length
    id = (is_ext_id ? str.substr(1, slcan.EXT_ID_LEN) :
          str.substr(1, slcan.STD_ID_LEN));
    // convert from hex string to number
    id = Number("0x" + id);
    if (isNaN(id)) {
        throw "Invalid ID value";
    }

    // data length code is single digit after id
    dlc = (is_ext_id ? str.substr(1 + slcan.EXT_ID_LEN, 1) :
           str.substr(1 + slcan.STD_ID_LEN, 1));
    dlc = Number(dlc);
    // check dlc is valid
    if (isNaN(dlc) || dlc < 0 || dlc > 8) {
        throw "Invalid DLC value"
    }

    for (var i = 0; i < dlc; i++) {
        // compute the position of the first char of the byte to read
        var pos = (is_ext_id ? (2 + slcan.EXT_ID_LEN + i * 2) :
                   (2 + slcan.STD_ID_LEN + i * 2));
        var b = Number("0x" + str.substr(pos, 2));
        if (isNaN(b)) {
            throw "Invalid data byte at position " + i;
        }
        data.push(b);
    }

    var res = new frame(id)
    res.id_ext_id = is_ext_id;
    res.is_remote = is_remote;
    res.dlc = dlc;
    res.data = data;

    return res;
}

/**
 * Helper function to pack a canbus.frame object into a slcan string
 * @method slcan._packFrame
 * @param {canbus.frame} frame Frame to pack into string
 * @private
 */
slcan.prototype._packFrame = function(frame) {
    // set frame as data or remote
    var res = frame.is_remote ? 'r' : 't';
    // set frame as standard or extended id
    if (frame.is_ext_id) {
        res = res.toUpperCase();
    }

    // add the identifier as hex, padded to the id length
    var id_str = "0000000" + frame.id.toString(16);

    if (frame.is_ext_id) {
        res = res + id_str.substr(id_str.length - slcan.EXT_ID_LEN).toUpperCase();
    } else {
        res = res + id_str.substr(id_str.length - slcan.STD_ID_LEN).toUpperCase();
    }

    //auto calculate dlc size
    frame.dlc = (frame.data.length > 8)?8:frame.data.length;

    // add the data length code
    res = res + frame.dlc.toString();

    // add the data bytes
    for (var i = 0; i < frame.dlc; i++) {
        // add byte as hex string, padded to 2 characters
        var byte_str = "0" + frame.data[i].toString(16).toUpperCase();
        res = res + byte_str.substr(byte_str.length - 2);
    }

    // terminate with \r
    res = res + "\r";
    return res;
}

module.exports = slcan
