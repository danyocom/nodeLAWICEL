var CANBUS = require('canbus');

function parseCanPacket(data){

    console.log(data);
}
var canbus = new CANBUS.slcan('/dev/cu.usbmodem1431',5,parseCanPacket);

canbus.open();

var myCanFrame = new CANBUS.frame(0x81);
myCanFrame.data = [50,0,133,0x64,0x11,0x3,0x00,0x00]

canbus.send(myCanFrame);