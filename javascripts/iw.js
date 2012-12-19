/*
  
  Required UI elements:

  - View most recent image
  - Adjust speed
  - Prev/next
  - Visual display 

*/

(function ($) { //Execute in a closed scope


//Try to force jQuery to support cors (cross origin)
$.support.cors = true;

window.Weather = {};
var w = window.Weather

w.defaults = {

  imagesNotFoundPath: "http://placehold.it/{width}x{height}&text=No%20images%20found",
  //Path templates
  metaPath: "http://s3-us-west-1.amazonaws.com/iw-metadata/channels/{channel}.js",/*
  metaPath: "http://d3bpvv0bm6k5s7.cloudfront.net/channels/{channel}.js",*//*
  imagePath: "http://d1gpvpc65ikqye.cloudfront.net/c/{channel}/{image}.jpg",*/
  imagePath: "http://server-1.apphb.com/c/{channel}/{image}.jpg",
  //If a channel doesn't have a standard sequence length, use this value
  defaultSequenceLength: 12,
  //check for updates every 60 seconds 
  //(CloudFront has 30-sec caching, so worst-case 1:30 delay, avg 45s)
  pollInterval: 60, 
  //Stop polling after 10 minutes
  pollDuration: 60 * 10, 
  //Disable polling by default
  poll:false,
  stillQuery: { time:"{{time}}" },
  seriesQuery: {  quality:80, },
  query: {width:640, height:480, mode:"max"},
  cycle: {
    loader: true, //true - wait for 2 frames, "wait" to Wait for all frames
    fx: "fadeout",
    speed: 100,
    timeout: 500
  },
  fullWidth: 640,
  fullheight:480,
};

//Builds an image URL (sans schema) with the given channel ID, image ID, and options struct
w.buildImageUrl = function(channel, image, options, metadata){
  var o = $.extend(true, {},w.defaults,options,{channel:channel,image:image},metadata);

  return w.resolveVars( w.addQuery(o.imagePath, o.query),o);
};

w.modUrl = function(imageMeta, query1, query2, query3,query4){
  return w.resolveVars(w.addQuery(imageMeta.url,$.extend({},query1,query2,query3,query4)),imageMeta);
}

w.resolveVars = function(url, vars){
  //replace all variables in the URL if there is a matching property in 'options' or 'metadata'
  for (var key in vars){
    url = url.replace(encodeURIComponent("{{" + key + "}}"),encodeURIComponent(vars[key]));
    url = url.replace("{{" + key + "}}",encodeURIComponent(vars[key]));
    url = url.replace("{" + key + "}",vars[key]);
  }
  return url;
};

w.addQuery = function(url, query){
  if (!query) return url;
  var c = url.indexOf('?');
  if (!(c < 0 && url.indexOf('=') < 0)){
    query = $.extend(true,{},w.parseQuery(url.substr(c + 1)),query);
    url = url.substr(0,c);
  }

  return url + "?" + w.stringifyQuery(query);
};


//Required parameters: channel, callback(results,options-copy), (optional) count

w.getImagesAsync = function(options){
  var o = $.extend(true,{},w.defaults,options);
  o.metaPath = w.resolveVars(o.metaPath, {channel:o.channel});

  o.pollSuccess = function(data){
    var results = [];
    var last = data.lastSequence || data.last;
    var count = this.count || data.sequenceLength || o.defaultSequenceLength;
    var i = last;
    while (results.length < count){
      //exit when an image has no metadata object.
      if (data.images[i] == undefined) break; 

      //For batch groups, we should never pull from a previous batch. 
      if (data.lastSequence && data.sequenceLength &&
        i < data.lastSequence - data.sequenceLength) break;

      //Skip dropped images
      if (!data.images[i].drop) {
        //Add a 'url' property to the existing metadata
        results.push($.extend(
          {},
          data.images[i],
          { image: i, 
            channel: this.channel,
            url: w.buildImageUrl(this.channel,i,this,data.images[i])}
        ));
      }
      i--;
    }
    //So oldest items go first instead of last
    results = results.reverse(); 
    //Update the results setting
    var oldresults = this.results;
    this.results = results;

    //Check for actual changes by checking first and last item URLs and count.
    var identical = oldresults != null;
    if (identical) identical = results.length == oldresults.length;
    if (results.length > 0){
      if (identical) identical = results[0].url == oldresults[0].url;
      if (identical) identical = results[results.length -1].url == oldresults[oldresults.length -1].url;
    }
    //If there were changes, fire callback
    if (!identical && this.callback){
      this.callback(this.results,this)
    }
    //Schedule next poll
    if (this.poll && ((new Date() - this.startedPoll) / 1000 < this.pollDuration)){
      var closure = this;
      setTimeout(function(){
        closure.beginPoll();
      },this.pollInterval * 1000)
    }
  };

  o.beginPoll = function(){
    this.startedPoll = new Date();
    $.ajax({
        url: this.metaPath,
        dataType: 'json',
        success: function(data){
            o.pollSuccess(data);
        },
        cache:false
    });
  };

  o.beginPoll();
  return o;
};


$.fn.Weather = function(options){



  var init = function(div, options){
    var api = {};

    var pq = {};
    if (div.width() > 0) pq.width  = div.width();
    if (div.height() > 0) pq.height  = div.height();

    var fromE = {};
    fromE.localQuery = pq;
    fromE.expand = div.hasClass("expand"); //colorbox it
    fromE.series = div.hasClass("series"); //cycle2 it
    fromE.channel = div.data('iw-channel');

    api.options = $.extend(true,{},w.defaults,fromE,options);

    api.options.callback = function(results, opts){
      //Destroy the existing slideshow
      if (api.content) api.content.cycle('destroy');
      delete api.content;
      //Clear existing content
      div.empty();

      var last = results.length > 0 ? results[results.length - 1] : null;

      //Deal with 0 result situation
      if (!last){
        //Fallback image
        var fb = api.options.imagesNotFoundPath;
        fb  =w.resolveVars(fb,{width:api.options.localQuery.width,
                              height: api.options.localQuery.height});

        div.append($("<img />").attr('src',fb));
        return;
      }

      var anchor = null;
      //We need a preview image for both popup series, popup stills, and linked stills.
      if (api.options.expand || !api.options.series){
        //Build preview image in case we need it later
        var previewImg = $("<img />").attr('src',
          w.modUrl(last, api.options.stillQuery, api.options.localQuery));
        
        anchor = $("<a />").attr('href', w.modUrl(last,api.options.stillQuery))
        anchor.append(previewImg).appendTo(div);

      }
      //Build the series
      if (api.options.series){

        //build the series
        var content = $("<div />");
        api.content = content;
        //content.css("width","640px");
        content.append("<div class=\"cycle-pager\"></div>");

        for (var i =0; i < results.length; i++){
          var c = results[i];
          var ci = $("<img />").attr('src',w.modUrl(c,api.options.seriesQuery)).appendTo(content);
          if (i != 0) ci.addClass("delay-display");
        }
        if (!api.options.expand) {
          content.appendTo(div);
          content.cycle($.extend(true,{},api.options.cycle));
        }
        else {
          anchor.data('content',content);
          anchor.data('content-backup',content.clone());
        }
      }
      if (api.options.expand){

        var seriesOpts = {inline:true,
                       preload:false,
            href:function(){
                return anchor.data('content');
            },
            onComplete: function(){
              $(this).data('content').cycle($.extend(true,{},api.options.cycle));
            },
            onCleanup: function(){
              $(this).data('content').cycle('destroy');
              $(this).data('content', $(this).data('content-backup').clone(true));
            } 
        };
        anchor.colorbox(api.options.series ? seriesOpts : null);
      }

    };

    api.poller = w.getImagesAsync(api.options);


    api.setOptions = function(options){
      api.options = $.extend(true, api.options,options);
      api.poller.pollInterval = api.options.pollInterval;
      api.poller.pollDuration = api.options.pollDuration;
    };

    return api;
  };

  var result = this;
  this.each(function () {
      var div = $(this);

      if (div.data('weather')) {
          // The API can be requested this way (undocumented)
          if (options == 'api') {
              result = div.data('weather');
              return;
          }
          // Otherwise, we just reset the options...
          else div.data('weather').setOptions(options);
      } else {
          div.data('weather', init(div, options));
      }
  });
  return result;

};

})(jQuery);


$(function(){
  $('.iw').Weather({channel: location.hash ? location.hash.substr(1) : null});
});


    //Polling methods
    //$('obj').ImageStudio('api').getStatus({'restoreSuspendedCommands':true, 'removeEditingConstraints':true, 'useEditingServer':false} ) returns { url, path, query };
    //$('obj').ImageStudio('api').setOptions({height:600});
    //$('obj').ImageStudio('api').setOptions({url:'newimageurl.jpg'}); //Yes, you can switch images like this.. as long as you're not in the middle of cropping. That's not supported yet.
    //$('obj').ImageStudio('api').getOptions();
    //$('obj').ImageStudio('api').destroy();
    //labels and icon values cannot be updated after initialization. 



(function () {
    var QueryString = {};

    QueryString.unescape = function (str, decodeSpaces) {
        return decodeURIComponent(decodeSpaces ? str.replace(/\+/g, " ") : str);
    };

    QueryString.escape = function (str) {
        return encodeURIComponent(str);
    };


    var stack = [];
    /**
    * <p>Converts an arbitrary value to a Query String representation.</p>
    *
    * <p>Objects with cyclical references will trigger an exception.</p>
    *
    * @method stringify
    * @param obj {Variant} any arbitrary value to convert to query string
    * @param sep {String} (optional) Character that should join param k=v pairs together. Default: "&"
    * @param eq  {String} (optional) Character that should join keys to their values. Default: "="
    * @param name {String} (optional) Name of the current key, for handling children recursively.
    * @static
    */
    QueryString.stringify = function (obj, sep, eq, name) {
        sep = sep || "&";
        eq = eq || "=";
        if (isA(obj, null) || isA(obj, undefined) || typeof (obj) === 'function') {
            return name ? encodeURIComponent(name) + eq : '';
        }

        if (isBool(obj)) obj = obj ? "true" : "false";
        if (isNumber(obj) || isString(obj)) {
            return encodeURIComponent(name) + eq + encodeURIComponent(obj);
        }
        if (isA(obj, [])) {
            var s = [];
            name = name + '[]';
            for (var i = 0, l = obj.length; i < l; i++) {
                s.push(QueryString.stringify(obj[i], sep, eq, name));
            }
            return s.join(sep);
        }
        // now we know it's an object.

        // Check for cyclical references in nested objects
        for (var i = stack.length - 1; i >= 0; --i) if (stack[i] === obj) {
            throw new Error("QueryString.stringify. Cyclical reference");
        }

        stack.push(obj);

        var s = [];
        var begin = name ? name + '[' : '';
        var end = name ? ']' : '';
        for (var i in obj) if (_.has(obj,i)) {
            var n = begin + i + end;
            s.push(QueryString.stringify(obj[i], sep, eq, n));
        }

        stack.pop();

        s = s.join(sep);
        if (!s && name) return name + "=";
        return s;
    };

    QueryString.parseQuery = QueryString.parse = function (qs, sep, eq) {
        return _.reduce(_.map(qs.split(sep || "&"),pieceParser(eq || "=")),mergeParams);
    };

    // Parse a key=val string.
    // These can get pretty hairy
    // example flow:
    // parse(foo[bar][][bla]=baz)
    // return parse(foo[bar][][bla],"baz")
    // return parse(foo[bar][], {bla : "baz"})
    // return parse(foo[bar], [{bla:"baz"}])
    // return parse(foo, {bar:[{bla:"baz"}]})
    // return {foo:{bar:[{bla:"baz"}]}}
    var pieceParser = function (eq) {
        return function parsePiece(key, val) {
            if (arguments.length !== 2) {
                // key=val, called from the map/reduce
                key = key.split(eq);
                return parsePiece(
                    QueryString.unescape(key.shift(), true),
                    QueryString.unescape(key.join(eq), true)
                );
            }
            key = key.replace(/^\s+|\s+$/g, '');
            if (isString(val)) {
                val = val.replace(/^\s+|\s+$/g, '');
                // convert numerals to numbers
                if (!isNaN(val)) {
                    var numVal = +val;
                    if (val === numVal.toString(10)) val = numVal;
                }
            }
            var sliced = /(.*)\[([^\]]*)\]$/.exec(key);
            if (!sliced) {
                var ret = {};
                if (key) ret[key] = val;
                return ret;
            }
            // ["foo[][bar][][baz]", "foo[][bar][]", "baz"]
            var tail = sliced[2], head = sliced[1];

            // array: key[]=val
            if (!tail) return parsePiece(head, [val]);

            // obj: key[subkey]=val
            var ret = {};
            ret[tail] = val;
            return parsePiece(head, ret);
        };
    };

    // the reducer function that merges each query piece together into one set of params
    function mergeParams(params, addition) {
        return (
        // if it's uncontested, then just return the addition.
            (!params) ? addition
        // if the existing value is an array, then concat it.
            : (isA(params, [])) ? params.concat(addition)
        // if the existing value is not an array, and either are not objects, arrayify it.
            : (!isA(params, {}) || !isA(addition, {})) ? [params].concat(addition)
        // else merge them as objects, which is a little more complex
            : mergeObjects(params, addition)
        );
    };

    // Merge two *objects* together. If this is called, we've already ruled
    // out the simple cases, and need to do the for-in business.
    function mergeObjects(params, addition) {
        for (var i in addition) if (i && _.has(addition,i)) {
            params[i] = mergeParams(params[i], addition[i]);
        }
        return params;
    };

    // duck typing
    function isA(thing, canon) {
        return (
        // truthiness. you can feel it in your gut.
            (!thing === !canon)
        // typeof is usually "object"
            && typeof (thing) === typeof (canon)
        // check the constructor
            && Object.prototype.toString.call(thing) === Object.prototype.toString.call(canon)
        );
    };
    function isBool(thing) {
        return (
            typeof (thing) === "boolean"
            || isA(thing, new Boolean(thing))
        );
    };
    function isNumber(thing) {
        return (
            typeof (thing) === "number"
            || isA(thing, new Number(thing))
        ) && isFinite(thing);
    };
    function isString(thing) {
        return (
            typeof (thing) === "string"
            || isA(thing, new String(thing))
        );
    };

    Weather.parseQuery = QueryString.parse;
    Weather.stringifyQuery = QueryString.stringify;
})();
