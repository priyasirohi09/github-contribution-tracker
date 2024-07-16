import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { subMonths, format, isAfter, parseISO } from 'date-fns';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import delay from 'delay'; // Import delay directly

const TOKEN = 'YOUR_GITHUB_TOKEN'; 

const query = `
query($userName:String!) {
  user(login: $userName){
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}
`;

async function retrieveContributionData(userName, retries = 3) {
  const variables = {
    userName
  };
  const body = {
    query,
    variables
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      return await res.json();
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < retries) {
        console.log(`Retrying in ${attempt * 2} seconds...`);
        await delay(attempt * 2000); // Exponential backoff delay
      } else {
        console.error(`All ${retries} attempts failed.`);
        throw error;
      }
    }
  }
}

const filterContributionEventsInLastMonth = (contributionDays) => {
  const oneMonthAgo = subMonths(new Date(), 1);
  return contributionDays.filter(day => isAfter(parseISO(day.date), oneMonthAgo));
};

const generateTableHeader = (dates) => {
  let header = '|       User       |';
  let separator = '|------------------|';
  dates.forEach(date => {
    header += ` ${date} |`;
    separator += '--------------|';
  });
  return `${header}\n${separator}`;
};

const generateTableRow = (username, contributionDates, dates) => {
  let row = `| ${username.padEnd(16)} |`;
  dates.forEach(date => {
    row += `      ${contributionDates.has(date) ? '1' : '0'}       |`;
  });
  return row;
};

const processBatch = async (usernames) => {
  const oneMonth = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date.toISOString().split('T')[0];
  });

  const rows = [];
  for (const username of usernames) {
    try {
      const data = await retrieveContributionData(username);
      if (!data || !data.data || !data.data.user) {
        // Add an empty row if fetching data failed
        rows.push(generateTableRow(username, new Set(), oneMonth));
        continue;
      }

      const contributionDays = data.data.user.contributionsCollection.contributionCalendar.weeks
        .flatMap(week => week.contributionDays);
      const filteredDays = filterContributionEventsInLastMonth(contributionDays);
      const contributionDates = new Set(filteredDays
        .filter(day => day.contributionCount > 0)
        .map(day => day.date));
      rows.push(generateTableRow(username, contributionDates, oneMonth));
    } catch (error) {
      console.error(`Failed to process ${username}: ${error.message}`);
      rows.push(generateTableRow(username, new Set(), oneMonth));
    }
  }

  return rows;
};

const main = async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const filePath = path.join(__dirname, 'demo.txt');
  const usernames = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

  const batchSize = 50; // Number of users per batch
  const delayBetweenBatches = 60000; // 1 minute delay between batches

  const oneMonth = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date.toISOString().split('T')[0];
  });

  console.log(generateTableHeader(oneMonth.map(date => format(new Date(date), 'MM/dd/yyyy'))));

  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    const rows = await processBatch(batch);
    rows.forEach(row => console.log(row));
    if (i + batchSize < usernames.length) {
      await delay(delayBetweenBatches);
    }
  }
};

main();
