/*
  
  Required UI elements:

  - View most recent image
  - Adjust speed
  - Prev/next
  - Visual display 

*/

/* Metadata channels should include:

width
height
description
batch
nextUpdate

*/

(function ($) { //Execute in a closed scope


//Try to force jQuery to support cors (cross origin)
$.support.cors = true;

window.Weather = {};
var w = window.Weather

//Single {vars} are replaced with un-encoded value. Use in URLs
//Double {{vars}} are replaced with URL-encoded contents. Use in querystrings.
w.defaults = {

  imagesNotFoundPath: "http://placehold.it/{width}x{height}&text=No%20images%20found",

  metadataErrorPath:"http://placehold.it/{width}x{height}&text={{textStatus}}:{{errorThrown}}",
  //Path templates
  metaPath: "http://s3-us-west-1.amazonaws.com/iw-metadata/channels/{channel}.js",/*
  metaPath: "http://d3bpvv0bm6k5s7.cloudfront.net/channels/{channel}.js",*/
  imagePath: "http://d1gpvpc65ikqye.cloudfront.net/c/{channel}/{id}.jpg",/*
  imagePath: "http://server-1.apphb.com/c/{channel}/{id}.jpg",*/
  //If a channel doesn't have a standard sequence length, use this value
  defaultSequenceLength: 12,
  //check for updates every 60 seconds 
  //(CloudFront has 30-sec caching, so worst-case 1:30 delay, avg 45s)
  pollInterval: 60, 
  //Stop polling after 10 minutes
  pollDuration: 60 * 10, 
  //Disable polling by default
  poll:false,
  stillQuery: { time:"{{time}}", watermark:"key-radar,logo-iw"  },
  seriesQuery: {  quality:80, watermark:"key-radar,logo-iw" },
  localQuery: {},
  query: { mode:"max"},
  cycle: {
    loader: "wait", // "wait" to Wait for all frames and display in-order
    fx: "fadeout",
    speed: 300,
    timeout: 1,
    lastTimeout:1500,
    firstTimeout:750
  },
  maxWidth: 1024,
  maxHeight: 768,
  defaultWidth: 640,
  defaultHeight: 480,
  defaultPreviewWidth: 400,
  defaultPreviewHeight: 300,
  //maxPreviewWidth: 400,
  //maxPreviewHeight: 300,
  //expand:false
  //series:false

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
w.toRelativeTime = function (milliseconds){
    var secs = Math.abs(milliseconds / 1000);
    var days = Math.floor(secs / (3600 * 24));
    secs %= 3600 * 24;
    var hrs = Math.floor( secs / 3600 );
    secs %= 3600;
    var mns = Math.floor( secs / 60 );
    secs %= 60;

    return (days > 0 ? days + " day" : "") + (days > 1 ? "s " : " ") + 
           (hrs > 0 ? hrs + " hour" : "") + (hrs > 1 ? "s " : " ") + 
           (mns > 0 ? mns + " minute" : "") + (mns > 1 ? "s " : " ") + 
           (milliseconds < 0 ? " ago" : " from now")
     
};

w.toShortRelativeTime = function (milliseconds){
    var secs = Math.abs(milliseconds / 1000);
    var hrs = Math.floor( secs / 3600 );
    secs %= 3600;
    var mns = Math.floor( secs / 60 );

    return (milliseconds > 0 ? "+" : "-") + 
           (hrs > 0 ? hrs + ":" : "0:") + 
           (mns > 10 ? "" : "0") + mns;
           
};

w.toLocalDateTime = function(dt){
  return moment(dt).format("M/D/YY h:mm A")
};

//Required parameters: channel, callback(results,options-copy), (optional) count

w.getImagesAsync = function(options){
  var o = $.extend(true,{},w.defaults,options);
  //The only variable supported in metadata URLs is {channel}
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
      if ((data.batch || data.batch === undefined) && data.lastSequence && data.sequenceLength &&
        i < data.lastSequence - data.sequenceLength) break;

      //Skip dropped images
      if (!data.images[i].drop) {

        //Add id, channel, [width], and [height] to metadata
        var meta = {id:i, channel:this.channel}
        if (data.width) meta.width = data.width;
        if (data.height) meta.height = data.height;
        if (data.description) meta.description = data.description;

        //Allow existing metadata to override our values
        $.extend(true,meta,data.images[i]);

        //Build URL - support variables from metadata AND settings
        meta.url = w.resolveVars( w.addQuery(this.imagePath, this.query),
            $.extend(true, {},this,meta));

        results.push(meta);
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
      this.callback(this.results,data, this)
    }
    //Schedule next poll
    this.schedulePoll();
  };

  o.schedulePoll = function(){
    //Schedule next poll
    if (this.poll && ((new Date() - this.startedPoll) / 1000 < this.pollDuration)){
      var closure = this;
      setTimeout(function(){
        closure.beginPoll();
      },this.pollInterval * 1000)
    }
  };

  o.pollError = function(jqXHR, textStatus, errorThrown){
    if (!this.results && this.errorCallback){
      this.errorCallback(jqXHR, textStatus, errorThrown);
    }
    this.schedulePoll();
  };

  o.beginPoll = function(){
    this.startedPoll = new Date();
    $.ajax({
        url: this.metaPath,
        dataType: 'json',
        success: function(data){
            o.pollSuccess(data);
        },
        error: function(jqXHR, textStatus, errorThrown){
          o.pollError(jqXHR, textStatus, errorThrown);
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
    if (div.height() > 0){
      pq.height  = div.height();
      if (div.width() > 0) pq.width  = div.width();
    } 

    var fromE = {};
    fromE.localQuery = pq;
    fromE.expand = div.hasClass("expand"); //colorbox it
    fromE.series = div.hasClass("series"); //cycle2 it
    fromE.channel = div.data('iw-channel');

    api.options = $.extend(true,{},w.defaults,fromE,options);

    api.options.errorCallback = function(jqXHR, textStatus, errorThrown){
        //Fallback image
        var fb = api.options.metadataErrorPath;
        fb  =w.resolveVars(fb,{width:api.options.localQuery.width,
                              height: api.options.localQuery.height, textStatus:textStatus,
                              errorThrown:errorThrown});

        div.append($("<img />").attr('src',fb));
    };

    api.options.callback = function(results, json, opts){
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

      var width = Math.min(api.options.maxWidth || Number.MAX_VALUE,
            api.options.width || 
            (api.options.expand || !api.options.series ? null : api.options.localQuery.width)
            || results[0].width || api.options.defaultWidth);
      var height = Math.min(api.options.maxHeight || Number.MAX_VALUE,
            api.options.height || 
            (api.options.expand || !api.options.series ? null : api.options.localQuery.height)
            || results[0].height || api.options.defaultHeight);



      //We need a preview image for both popup series, popup stills, and linked stills.
      if (api.options.expand || !api.options.series){

        var previewWidth = Math.min(api.options.maxPreviewWidth || Number.MAX_VALUE,
            api.options.previewWidth ||  api.options.localQuery.width ||
            results[0].width || api.options.defaultPreviewWidth);

        var previewHeight = Math.min(api.options.maxPreviewHeight || Number.MAX_VALUE,
            api.options.previewHeight ||  api.options.localQuery.height ||
            results[0].height || api.options.defaultPreviewHeight);

        //Build preview image in case we need it later
        var previewImg = $("<img />").attr('src',
          w.modUrl(last, api.options.stillQuery, api.options.localQuery, 
            {width:previewWidth,height:previewHeight} 
            ));
        
        anchor = $("<a />").attr('href', w.modUrl(last,api.options.stillQuery, {width:width,height:height}))
        anchor.append(previewImg).appendTo(div);

      }
      //Build the series
      if (api.options.series){

        //build the series
        var content = $("<div />");
        api.content = content;
        content.css("width", width);
        content.css("height", height);
        content.addClass("iw-series-cycle2");


        var topbar = $("<div class=\"iw-topbar delay-display\"></div>");

        var seriesTitle = $("<span class=\"iw-title\" />").appendTo(topbar);
        var labelTime = $("<span class=\"iw-time\" />").appendTo(topbar);

        
        var controls = $("<div class=\"iw-controls\"></div>");
        controls.append("<span class=\"iw-prev icon-backward icon-2x\" />");
        controls.append("<span class=\"iw-pauseplay icon-play icon-2x\" />");
        controls.append("<span class=\"iw-next icon-forward icon-2x\" />");



        content.append(topbar);
        topbar.append(controls);

        var slideCount = results.length;

        var updateView = function(event, optionHash, slideOptionsHash, currentSlideEl){
          var s = $(currentSlideEl);

          var dateUtc = s.data('cycle-date');
          
          seriesTitle.text((c.description || api.options.description || "") + 
            " - " + w.toRelativeTime(dateUtc - Date.now()) + 
            " - " + (s.data('index') + 1) + " of " + slideCount + "" );

          labelTime.text(w.toLocalDateTime(dateUtc));

          topbar.removeClass("delay-display");
        };


        for (var i =0; i < results.length; i++){
          var c = results[i];
          var ci = $("<img />").attr('src',
            w.modUrl(c,api.options.seriesQuery,{width:width,height:height}))
            .addClass("delay-display").appendTo(content);
          ci.data('index',i);
          ci.data('cycle-date', new Date(c.time));
          if (i ==0 || i == results.length - 1){
            ci.data('cycle-timeout', i == 0 ? api.options.cycle.firstTimeout : api.options.cycle.lastTimeout);
          }
        }
        var configCycle = function(elem){
          //Pause if a pager is clicked
          elem.on('cycle-pager-activated',function(){
            elem.cycle('pause');
          });

          //Toggle pause/play on canvas click or pauseplay click
          var toggleState = function(){
            elem.cycle(elem.hasClass("cycle-paused") ? 'resume' : 'pause');
          };
          elem.on('mousedown','img, .iw-pauseplay, .pauseplay, .cycle-overlay',toggleState);

          //Add an view update handler for info display
          elem.on("cycle-update-view",updateView);

          //Add previous button logic
          elem.find(".iw-prev").click(function(){
            elem.cycle('pause');
            elem.cycle('prev');
          });

          //Add next button logic
          elem.find(".iw-next").click(function(){
            elem.cycle('pause');
            elem.cycle('next');
          });
        };

        if (!api.options.expand) {
          content.appendTo(div);
          content.cycle($.extend(true,{},api.options.cycle));
          configCycle(content);
        }
        else {


          anchor.data('colorbox-options', {inline:true,
                            preload:false,
              href:function(){
                  return anchor.data('content');
              },
              onComplete: function(){
                $(this).data('content').cycle($.extend(true,{},api.options.cycle));
                configCycle($(this).data('content'));
              },
              onCleanup: function(){
                $(this).data('content').cycle('destroy');
                $(this).data('content', $(this).data('content-backup').clone(true));
              } 
          });

          anchor.data('content',content);
          anchor.data('content-backup',content.clone(true));
        }


      }
      if (api.options.expand){
        anchor.colorbox($.extend({scrolling:false, innerWidth:width,innerHeight:height},
            anchor.data('colorbox-options') ? anchor.data('colorbox-options') : {}));
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
  $('.iw').Weather({channel: location.hash ? location.hash.substr(1) : "5"});
});




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
