var request = require('request'),
    rp = require('request-promise'),
    Promise = require('bluebird'),
    cheerio = require('cheerio'),
    hash = require('hash.js')

module.exports = function(context, cb) {
  function generateId(obj){
    return hash.sha256().update(obj.address.concat(obj.email,obj.phone,obj.beds,obj.baths)).digest('hex')
  }
  function getBlacklist(){
    return rp({
        url: "https://api.mlab.com/api/1/databases/trulia/collections/blacklist",
        qs:{
          apiKey:context.secrets.mlabKey,
          l:10000
        },
        json:true,
    	  method: "GET"
    }).promise()
  }
  function addToDb(listings){
    return rp({ 
        url: "https://api.mlab.com/api/1/databases/trulia/collections/listings",
        qs:{
          apiKey:context.secrets.mlabKey
        },
        headers:{
          "Content-Type": "application/json" 
        },
  		  body: listings,
  		  method: "POST",
  		  json: true
    }).promise()
  }
  function getListingData(url){
    var id = url.split('rental/')[1].split('-')[0];
    // console.log(id);
    return rp({
        url: "https://origin-api.trulia.com/app/v6/detail",
        method: "GET",
        qs: {
            "id": id,
            "module": "(agents|homefacts|scoop)",
        },
        headers: {
            "Accept": "application/json",
            "Host": "origin-api.trulia.com",
            "Trulia-Mpid": "205042575",
            "User-Agent": "tr-src/IosRental tr-ver/5.10 tr-osv/10.3.2",
        },
        json:true
    }).then(function(body){
      // console.log(JSON.stringify(body));
      var res = body.result;
      var ret = {
        beds: res.bd || "0",
        baths: res.ba || "0",
        tom: (res.attr && res.attr[0] && res.attr[0].data) ? res.attr[0].data : "-",
        neighborhood: res.nh || "-",
        address: [res.stn, res.std, res.apt ? "#"+res.apt : undefined].filter(function(a){return a}).join(' '),
        email: (res.agents && res.agents[0] && res.agents[0].email) ? res.agents[0].email : '-',
        phone: (res.agents && res.agents[0] && res.agents[0].phone) ? res.agents[0].phone : '-',
        userName: (res.agents && res.agents[0]) ? res.agents[0].userName : '-'
      };
      if (body.result.agents){
        // ret = Object.assign(ret, body.result.agents[0]);
        return ret;
      }
      return {beds: body.result.cta.description};
    })
  };
  function getDaysListings(day){
    return rp({
      url: 'https://www.trulia.com/new-for-rent-properties/DC/'.concat(day ? moment(day).format('YYYY-MM-DD') : ''),
      method: "GET",
      transform:function(body){
        return cheerio.load(body);
      }
    }).promise().then(function($){
      return $('ul.listUnbulleted li a').map(function(){
        return $(this).attr('href');
      }).get()
    })
  };
  
  var day = context.data.day;
  return getDaysListings(day)
    .map(getListingData)
    .then(function(listings){
      return getBlacklist()
        .then(function(blk){
          // console.log(typeof blk);
          return listings.map(function(listing){
            
            blk.forEach(function(domain){
              if (listing.email.indexOf(domain.nix) > -1){
                listing = undefined;
                return undefined;
              };
              return listing
            });

            if (listing) listing._id = generateId(listing);
            return listing;
          }).filter(function(a){return a});
        
        })
    })
    .then(addToDb)
    .then(function(a){
      console.log(a);
      return cb(null,a);
    })
    .catch(cb)
    
};