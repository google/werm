t.io.print = (function(str) { console.log("printing: " + JSON.stringify(str)); this.print(str) }).bind({print: t.io.print.bind(t.io)});
