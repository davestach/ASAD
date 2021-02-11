/* ----- DEPENDENCIES -----*/
const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const { gmail } = require('googleapis/build/src/apis/gmail');
const { release } = require('os');
const axios = require('axios');
require('dotenv').config();


/* ----- HELPER FUNCTIONS -----*/
const encodeString = require('./helpers/encodeString');
const decodeString = require('./helpers/decodeString');
const getEmailContent = require('./helpers/getEmailContent');
const getSpotifyLink = require('./helpers/getSpotifyLink');
const getSpotifyToken = require('./helpers/getSpotifyToken');


/*----- GMAIL AUTH -----*/
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'backend/lib/token.json';

// Load client secrets from a local file.
fs.readFile('backend/credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Gmail API.
  authorize(JSON.parse(content), seedDb);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}


/*----- SEED FUNCTION -----*/
async function seedDb(auth) {

  // gmail config
  const gmail = google.gmail({version: 'v1', auth});

  // nextCatalogueNum and date variables
  let nextCatalogueNum = 12;

  let startDate = new Date('2019, 4, 26');
  let [afterMonth, afterDate, afterYear] = startDate.toLocaleDateString("en-US").split("/");
  let afterSearchDate = `${afterMonth}/${afterDate}/${afterYear}`;

  let targetDate = new Date('2019, 5, 1');
  let [beforeMonth, beforeDate, beforeYear] = targetDate.toLocaleDateString("en-US").split("/");
  let beforeSearchDate = `${beforeMonth}/${beforeDate}/${beforeYear}`;
  
  //initialize an array to push new entries to with existing JSON file entries
  let entryJSON = [];
  fs.readFile('backend/lib/entries.json', (err, data) => {
    if (err) throw new Error('fs returned an error: ' + error);

    entryJSON.push(JSON.parse(data));
  });

  // define function to run at an interval
  const findEntry = async () => {

    // fetch recent email list
    await gmail.users.messages.list({
      userId: 'me',
      labelIds: 'Label_4083780721970678911',
      q: `after:${afterSearchDate} before:${beforeSearchDate}`
    }, async (error, response) => {
      if (error) throw new Error('The API returned an error: ' + error);
      let recentEmailList = response.data.messages;
      
      // loop over recentEmailList
      for (i = 0; i < recentEmailList.length; i++) {

        // filter emailList by threadId
        let emailThread = recentEmailList.filter(email => email.threadId === recentEmailList[i].threadId);

        // grab id of origin email in thread
        let originEmailId = emailThread[emailThread.length - 1].id;

        // get origin email
        let originEmail = await getEmailContent(gmail, originEmailId);

        // get headers
        let headers = originEmail.data.payload.headers;

        // grab the catalogue number
        let subjectHeader = headers.filter(header => header.name === 'Subject');
        let catalogueNum = parseInt(subjectHeader[0].value.split(' ')[1]);

        if (catalogueNum === nextCatalogueNum) {
          // get email body and replace ascii characters
          let emailBody = originEmail.data.snippet;
          let emailContent = decodeString(emailBody)

          // get date header and grab send date
          let sendDateHeader = headers.filter(header => header.name === 'Date');
          let sendDate = sendDateHeader[0].value

          // grab artist name from email content
          const artistNameRegex = /.+\s-\s/
          let artistNameIdx = emailContent.match(artistNameRegex)[0]
          let artistName = artistNameIdx.slice(0, -3)

          // grab song title from email content
          const songTitleRegex = /[^-]+\(\d{4}\)/
          let songTitleIdx = emailContent.match(songTitleRegex)[0]
          let songTitle = songTitleIdx.slice(1, -6).trim()

          // grab release date from email content
          const releaseDateRegex = /\(\d{4}\)/
          let releaseDateIdx = emailContent.match(releaseDateRegex)[0];
          let releaseDate = parseInt(releaseDateIdx.slice(1, 5))

          // form URL for Spotify search
          let artistSearch = encodeString(artistName);
          let songSearch = encodeString(songTitle);
          let searchUrl = `https://api.spotify.com/v1/search?q=${artistSearch}+${songSearch}&type=track`;
          
          // get bearer token, then spotify link
          let spotifyToken = await getSpotifyToken();
          let spotifyLink = await getSpotifyLink(searchUrl, spotifyToken);
        
          // define new entry to push to JSON
          let newEntry = {
            catalogue_num: catalogueNum,
            send_date: sendDate,
            artist: artistName,
            song: songTitle,
            release_date: releaseDate,
            spotify_link: spotifyLink
          };
          console.log(newEntry);

          // push entry
          entryJSON[0].entries.push(newEntry);
          // stringify for writing
          const entryContent = JSON.stringify(...entryJSON);
          // write new file
          fs.writeFile('backend/lib/entries.json', entryContent, (err) => {
            if (err) throw new Error('fs returned an error: ' + error);
            console.log('Entry saved.');
          });

          // increment start date to next day and increment catalogue num.
          startDate.setDate(startDate.getDate() + 1);
          [month, date, year] = startDate.toLocaleDateString("en-US").split("/");
          searchDate = `${month}/${date}/${year}`;
          nextCatalogueNum++;

          if (startDate >= targetDate) {
            clearInterval(postEntryInterval);
          };

          break;
        };
      };
    });
  };
  
  // determine interval at which to run this very ridiculous function
  let postEntryInterval = setInterval(findEntry, 5000);
};