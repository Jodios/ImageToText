import { createWorker, createScheduler } from "tesseract.js";
import fs from "fs";
import path from "path";
import axios from "axios";

const worker1 = createWorker();
const worker2 = createWorker();
const worker3 = createWorker();
const scheduler = createScheduler();
const pathToImages = path.join(__dirname, "resources");
const pathToText = path.join(__dirname, "greentext_output");
const imagesToDownload = 10;

const url = `https://api.pushshift.io/reddit/search/submission/?subreddit=greentext&sort=desc&sort_type=created_utc&size=${imagesToDownload}`;
if(!fs.existsSync(pathToImages)) 
    fs.mkdirSync(pathToImages);
if(!fs.existsSync(pathToText))
    fs.mkdirSync(pathToText);

/**
 * Getting all image urls from r/greentext.
 * Downloading pictures into src/resources for reference but files on your
 * system aren't used. 
 * After all urls are collected, they are passed into {@method parseImages}
 */
axios.get(url).then(async (response) => {
    let data: Object[] = response.data.data;
    let imageLinks: Object[] = [];
    await data.forEach(x => {
        if(!x['url']) return;
        let type = x['url'].split(".")[3];
        let name = (x['url'].split(".")[2]).split("/")[1]+"."+type;
        let imagePath = path.join(pathToImages, name);
        if(type && !fs.existsSync(imagePath) && x['url']){
            imageLinks.push({url: x['url'], name: name});
            axios.get(x['url'], {responseType: "stream"}).then(async imageStream => {
                await imageStream.data.pipe(fs.createWriteStream(imagePath));
                console.log(`${name} downloaded`)
            }).catch((reason) => console.log(reason+"\n"));
        }
    })
    await parseImages(imageLinks)

}).catch(err => console.log(err.message));

/**
 * This method is using tesseract to read the images
 * and extract the text from them. Text files are stores in
 * src/greentext_output
 * @param imageNamesAndLinks List of all image urls in the format {url: http://link.com, name: myImage.jpg}
 */
const parseImages = async (imageNamesAndLinks: Object[]) => {
    if(imageNamesAndLinks.length == 0){
        console.log("DONE");
    }
    await worker1.load();
    await worker1.loadLanguage('eng');
    await worker1.initialize('eng');
    await worker2.load();
    await worker2.loadLanguage('eng');
    await worker2.initialize('eng');
    await worker3.load();
    await worker3.loadLanguage('eng');
    await worker3.initialize('eng');
    scheduler.addWorker(worker1);
    scheduler.addWorker(worker2);
    scheduler.addWorker(worker3);

    Promise.all( 
        imageNamesAndLinks.map(async (imageObj) => {
            let imagePath = path.join(pathToImages, imageObj['name']);
            console.log(imagePath)
            return {result: await scheduler.addJob('recognize', imagePath), imageName: imageObj['name']};
        })
    ).then( results => {
        scheduler.terminate();
        results.forEach(result => {
            let text = result.result.data.text.replace(/^\s*[\r\n]/gm, "");
            fs.writeFile( path.join(pathToText, result.imageName.split(".")[0]+".txt"), text, (err) => console.log(err) );
        });
        console.log("DONE");
    }).catch(err => {
        console.log(err);
    });

}