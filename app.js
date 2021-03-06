'use strict';

const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request')
const app = express();
const uuid = require('uuid');
const axios = require('axios');
const cheerio = require("cheerio");
const pg = require('pg');

pg.defaults.ssl = true;

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
    throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
    throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
    throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
    throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}
if (!config.PG_CONFIG) {
    throw new Error('missing PG_CONFIG');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());






const credentials = {
    client_email: config.GOOGLE_CLIENT_EMAIL,
    private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
    {
        projectId: config.GOOGLE_PROJECT_ID,
        credentials
    }
);


const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    console.log(JSON.stringify(data));



    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});





function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }
    //console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    //console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to api.ai
        sendToDialogFlow(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleMessageAttachments(messageAttachments, senderID){
    //for now just reply
    sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
    sendToDialogFlow(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleDialogFlowAction(sender, action, messages, contexts, parameters) {

    function getBreweryData(prop) {
        let ent = ''
        if (prop == 'city') {
            ent = 'geo-city'
        } else if (prop == 'name') {
            ent = 'any'
        }
        if ( parameters.fields.hasOwnProperty(ent) && parameters.fields[ent].stringValue!='' ) {
    
            // handle inputs with multiple words
            let brew = (parameters.fields[ent].stringValue).replace(/[, ]+/g, " ").trim().split(" ")
            console.log(brew)
            let brewery = ""
            if (brew.length > 1) { 
                for (var i = 0; i <= brew.length - 1; i++) {
                    if (i == brew.length - 1) {
                        brewery += brew[i]
                    } else {
                        brewery += brew[i]
                        brewery += "_"
                    }                    
                } 
            } else {
                brewery = brew[0]
            }
    
            console.log(prop)
            console.log(ent)
            console.log(brewery)
    
            // Places API key
            const key = "AIzaSyBzRPO1aFfHK14R7PFF__v_XTghJb_TQOI";
            var elements = [];
    
            const getData = async() => {
                try {
                    const apiCall1 = await axios.get(`https://api.openbrewerydb.org/breweries?by_${prop}=${brewery}`);
                    var arr = []
                    var nameArr = []
                    var cityArr = []
                    var streetArr = []
                    var stateArr = []
                    var urlArr = []
                    for (var i = 0; i <= apiCall1.data.length - 1; i++) {
                        const api = await axios.get(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${apiCall1.data[i].name}%20${apiCall1.data[i].city}&inputtype=textquery&fields=photos&key=${key}`)
                        arr.push(api.data)
                    }
    
                    for (var i = 0; i <= apiCall1.data.length - 1; i++) {
                        nameArr.push(apiCall1.data[i].name)
                        streetArr.push(apiCall1.data[i].street)
                        cityArr.push(apiCall1.data[i].city)
                        stateArr.push(apiCall1.data[i].state)
                        urlArr.push(apiCall1.data[i].website_url)
                    }
                    
                    for (var j = 0; j <= arr.length - 1; j++) {
    
                        let url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${arr[j].candidates[0].photos[0].photo_reference}&key=${key}`
                        
                        if (nameArr[j] != '' && streetArr[j] != '' && cityArr[j] != '' && stateArr[j] != '' && urlArr[j] != '') {    
                            let element = {
                                "title": `${nameArr[j]}`,
                                "image_url":`${url}`,
                                "subtitle":`${streetArr[j]} ${cityArr[j]}, ${stateArr[j]}`,
                                "default_action": {
                                "type": "web_url",
                                "url": `${urlArr[j]}`,
                                "webview_height_ratio": "tall",
                                },
                                "buttons":[
                                    {
                                        "type":"web_url",
                                        "url":`${urlArr[j]}`,
                                        "title":"View Website"
                                    },{
                                        "type":"web_url",
                                        "url": `https://www.google.com/maps/search/?api=1&query=${nameArr[j]} ${cityArr[j]}`,
                                        "title":"Get Directions",
                                    }              
                                ]      
                            }
                            
                        console.log("pushed")
                        console.log(j)
                        console.log(element)
                        elements.push(element)
                        } else {
                            console.log("returned")
                        }
                    }
                } catch(e) {
                    console.log(e)
                    sendTextMessage(sender, `Sorry, I don't have any available data for ${parameters.fields[ent].stringValue}`)
                }
                sendGenericMessage(sender, elements);
            }
    
            getData() 
            
            
        } else {
            handleMessages(messages, sender);
        }
    }
    
    function getBeerData() {
        if ( parameters.fields.hasOwnProperty('any') && parameters.fields['any'].stringValue!='' ) {
            let input = parameters.fields['any'].stringValue
            let beer = input.split(" ")
            let beerQuery = ""
    
            if (beer.length > 1) { 
                for (var i = 0; i <= beer.length - 1; i++) {
                    if (i == beer.length - 1) {
                        beerQuery += beer[i]
                    } else {
                        beerQuery += beer[i]
                        beerQuery += "+"
                    }                    
                } 
            } else {
                beerQuery = beer[0]
            }
    
            var elements = [];
    
            console.log(beerQuery)
    
            const scrapeBeer = async() => {
                try {
    
                    const html1 = await axios.get(`https://www.beeradvocate.com/search/?q=${beerQuery}`);
                    const $ = await cheerio.load(html1.data);
                    let data = [];
    
                    $('div[id="ba-content"]').find('div > div > a:nth-child(2)').each((i, elem) => {
                            data.push({
                                beer: $(elem).text(),
                                link: $(elem).attr('href')
                                })
                            });
    
                    console.log(`profileURL: https://www.beeradvocate.com${data[0].link}`)
                    
                    const html2 = await axios.get(`https://www.beeradvocate.com${data[0].link}`)
                    const $$ = await cheerio.load(html2.data);
                    let getAbv = [], getBeerType = [], getBrewery = [], getImg = []
    
                    $$('#info_box').find('#info_box > div:nth-child(3) > dl > dd > span > b').each((i, elem) => {
                        getAbv.push({
                            abv: $$(elem).text(),
                        })
                    });
    
                    $$('#info_box').find('#info_box > div:nth-child(3) > dl > dd:nth-child(2) > a:nth-child(1) > b').each((i, elem) => {
                    getBeerType.push({
                        type: $$(elem).text(),
                        })
                    });
    
                    $$('#info_box').find('#info_box > div:nth-child(3) > dl > dd:nth-child(14) > a').each((i, elem) => {
                        getBrewery.push({
                            brewery: $$(elem).text(),
                            })
                        });
    
                    // $$('#info_box').find('#info_box > div:nth-child(3) > dl > dd:nth-child(16)').each((i, elem) => {
                    //     getLocation.push({
                    //         location: $$(elem).text(),
                    //         })
                    //     });
    
                    $$('#main_pic_norm').find('#main_pic_norm > div > img').each((i, elem) => {
                        getImg.push({
                            image: $$(elem).attr('src'),
                            })
                        });
    
                    // console.log(data[0].beer, getAbv[0], getBeerType[0], getBrewery[0], getLocation[0], getImg[0])
    
                    let element = {
                        "title": `${data[0].beer}`,
                        "image_url":`${getImg[0].image}`,
                        "subtitle":`${getBeerType[0].type} // ${getAbv[0].abv} ABV // ${getBrewery[0].brewery}`,
                        "default_action": {
                        "type": "web_url",
                        "url": `https://www.beeradvocate.com${data[0].link}`,
                        "webview_height_ratio": "tall",
                        },
                        "buttons":[
                            {
                                "type":"web_url",
                                "url":`https://www.beeradvocate.com${data[0].link}`,
                                "title":"Full Profile"
                            }            
                        ]      
                    }
    
                    console.log(element)
                    elements.push(element);
                } catch(e) {
    
                    sendTextMessage(sender, `Sorry, I don't have any available data for ${parameters.fields['any'].stringValue}`)
                    return e
                }
                
                sendGenericMessage(sender, elements);
            }
    
            scrapeBeer()
        } else {
            handleMessages(messages, sender);
        }
    }
    
    switch (action) {
        // get brewery by name intent
        case "get-name":
            getBreweryData('name');
            break;
        case "get-city":
            getBreweryData('city')
            break;
        case "get-beer":
            getBeerData()
            break;
        default:
            //unhandled action, just send back the text
            handleMessages(messages, sender);
    }
}

function handleMessage(message, sender) {
    switch (message.message) {
        case "text": //text
            message.text.text.forEach((text) => {
                if (text !== '') {
                    sendTextMessage(sender, text);
                }
            });
            break;
        case "quickReplies": //quick replies
            let replies = [];
            message.quickReplies.quickReplies.forEach((text) => {
                let reply =
                    {
                        "content_type": "text",
                        "title": text,
                        "payload": text
                    }
                replies.push(reply);
            });
            sendQuickReply(sender, message.quickReplies.title, replies);
            break;
        case "image": //image
            sendImageMessage(sender, message.image.imageUri);
            break;
    }
}


function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.card.buttons.length; b++) {
            let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.card.buttons[b].text,
                    "url": message.card.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.card.buttons[b].text,
                    "payload": message.card.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.card.title,
            "image_url":message.card.imageUri,
            "subtitle": message.card.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleMessages(messages, sender) {
    let timeoutInterval = 1100;
    let previousType ;
    let cardTypes = [];
    let timeout = 0;
    for (var i = 0; i < messages.length; i++) {

        if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        } else if ( messages[i].message == "card" && i == messages.length - 1) {
            cardTypes.push(messages[i]);
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if ( messages[i].message == "card") {
            cardTypes.push(messages[i]);
        } else  {

            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        }

        previousType = messages[i].message;

    }
}

function handleDialogFlowResponse(sender, response) {
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    sendTypingOff(sender);

    if (isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (isDefined(messages)) {
        handleMessages(messages, sender);
    } else if (responseText == '' && !isDefined(action)) {
        //dialogflow could not evaluate input.
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(responseText)) {
        sendTextMessage(sender, responseText);
    }
}

async function sendToDialogFlow(sender, textString, params) {

    sendTypingOn(sender);

    try {
        const sessionPath = sessionClient.sessionPath(
            config.GOOGLE_PROJECT_ID,
            sessionIds.get(sender)
        );

        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: textString,
                    languageCode: config.DF_LANGUAGE_CODE,
                },
            },
            queryParams: {
                payload: {
                    data: params
                }
            }
        };
        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        handleDialogFlowResponse(sender, result);
    } catch (e) {
        console.log('error');
        console.log(e);
    }

}




function sendTextMessage(recipientId, text) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }
    callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
                            timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata)?metadata:'',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v3.2/me/messages',
        qs: {
            access_token: config.FB_PAGE_TOKEN
        },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}

function greetUserText(userId) {
	//first read user firstname
	request({
		uri: 'https://graph.facebook.com/v3.2/' + userId,
		qs: {
			access_token: config.FB_PAGE_TOKEN
        },
	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);
			console.log('getUserData: ' + user);
			if (user.first_name) {
				var pool = new pg.Pool(config.PG_CONFIG);
                pool.connect(function(err, client, done) {
                    if (err) {
                        return console.error('Error acquiring client', err.stack);
                    }
                    var rows = [];
                    client.query(`SELECT fb_id FROM users WHERE fb_id='${userId}' LIMIT 1`,
                        function(err, result) {
                            if (err) {
                                console.log('Query error: ' + err);
                            } else {

                                if (result.rows.length === 0) {
                                    let sql = 'INSERT INTO users (fb_id, first_name, last_name, profile_pic) ' +
										'VALUES ($1, $2, $3, $4)';
                                    client.query(sql,
                                        [
                                            userId,
                                            user.first_name,
                                            user.last_name,
                                            user.profile_pic
                                        ]);
                                }
                            }
                        });

                });
                pool.end();
                
				sendTextMessage(userId, "Hi there, " + user.first_name + "! I'm brewski_bot, the virtual drinking buddy! 🤖",);
			} else {
				console.log("Cannot get data for fb user with id",
                    userId);
                sendTextMessage(userId, "Hi there! I'm brewski_bot, the virtual drinking buddy! 🤖",);
			}
		} else {
			console.error(response.error);
		}

	});
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    const greeting = [
        "I can search for breweries by name or by city 🌎",
        "Fetch profiles for individual beers 🍺",
        "And help you find a ride home 🚕",
        "Say \"Menu\" at any time to perform a new search 🔍",
        "Or click the Menu button to the right ➡️"
    ]

    function delay(time) {
        return new Promise(function(resolve, reject) {
          setTimeout(resolve, time);
        });
      }

    function sendGreeting() {
        delay(2000).then(() => {
            greetUserText(senderID);
            delay(2000).then(() => {
                sendTextMessage(senderID, greeting[0])
                delay(2000).then(() => {
                    sendTextMessage(senderID, greeting[1])
                    delay(2000).then(() => {
                        sendTextMessage(senderID, greeting[2])
                        delay(2000).then(() => {
                            sendTextMessage(senderID, greeting[3])
                            delay(2000).then(() => {
                                sendTextMessage(senderID, greeting[4])
                            })
                        })
                    })
                })
            })
        })
    }

    switch (payload) {
            case 'GET_STARTED':
                sendGreeting();
                break;
            case 'MENU':
                sendToDialogFlow(senderID, 'Menu');
                break;
            default:
                //unindentified payload
                sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
                break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
})
