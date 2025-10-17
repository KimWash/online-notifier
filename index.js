const puppeteer = require('puppeteer');
const reminders = require('node-reminders');




async function fetchTasks(username, password) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // LMS 로그인 페이지 접속
  await page.goto('https://cyber.inu.ac.kr/login.php');

  // 로그인 폼 입력 및 제출
  await page.type('input#input-username', username);
  await page.type('input#input-password', password);
  await page.click('input[name="loginbutton"]');

  // 로그인 후 할 일 페이지로 이동 (실제 URL은 로그인 후 브라우저에서 확인 필요)
  await page.waitForNavigation();
  await page.goto('https://cyber.inu.ac.kr/local/ubnotification/');



  // 시청해야 할 동영상과 과제 목록 추출 (알림)
  const result = await page.evaluate(() => {
    const videos = [];
    const assignments = [];
    const idFromUrl = url => {
      const m = url.match(/id=(\d+)/);
      return m ? m[1] : null;
    };
    document.querySelectorAll('.media').forEach(media => {
      // text-through 클래스로 감싸진 .media는 제외
      if (media.closest('.text-through')) return;
      const img = media.querySelector('img.media-object');
      const body = media.querySelector('.media-body');
      const title = body?.querySelector('.media-heading')?.innerText || '';
      const section = body?.querySelector('.sectionname')?.innerText || '';
      const link = media.querySelector('a')?.href || '';
      const desc = body?.querySelector('p:last-of-type')?.innerText || '';
      const id = idFromUrl(link);
      if (!id) return;
      if (img && img.src.includes('vod')) {
        videos.push({ id, title, section, link, desc });
      } else if (img && img.src.includes('assign')) {
        assignments.push({ id, title, section, link, desc });
      }
    });
    // id 기준 중복 제거
    const unique = arr => Object.values(arr.reduce((acc, cur) => { acc[cur.id] = cur; return acc; }, {}));
    return { videos: unique(videos), assignments: unique(assignments) };
  });

  await page.goto('https://cyber.inu.ac.kr/');

  // 타임라인에서 과제/동영상 파싱
  const timeline = await page.evaluate(() => {
    const videos = [];
    const assignments = [];
    const idFromUrl = url => {
      const m = url.match(/id=(\d+)/);
      return m ? m[1] : null;
    };
    console.log(document.querySelectorAll('ul.timeline > li'))
    document.querySelectorAll('ul.timeline > li').forEach(li => {
      const a = li.querySelector('a');
      const img = li.querySelector('img.icon');
      const title = li.querySelector('.title h5')?.innerText || '';
      const link = a?.href || '';
      const date = li.querySelector('.upcomming_date')?.innerText || '';
      console.log(date)
      const id = idFromUrl(link);
      if (!id) return;
      if (img && img.src.includes('vod')) {
        videos.push({ id, title, link, date });
      } else if (img && img.src.includes('assign')) {
        assignments.push({ id, title, link, date });
      }
    });
    // id 기준 중복 제거
    const unique = arr => Object.values(arr.reduce((acc, cur) => { acc[cur.id] = cur; return acc; }, {}));
    return { videos: unique(videos), assignments: unique(assignments) };
  });
  await page.browser().close()
  return { notification: result, timeline, }
}



async function addAllContentsToReminders() {
  const {id, pw} = require('./credentials.json')
  const { notification, timeline } = await fetchTasks(id, pw);

  // 모든 콘텐츠를 id 기준으로 합치기
  const allVideos = [...notification.videos, ...timeline.videos];
  const allAssignments = [...notification.assignments, ...timeline.assignments];
  const uniqueById = arr => Object.values(arr.reduce((acc, cur) => { acc[cur.id] = cur; return acc; }, {}));
  const videos = uniqueById(allVideos);
  const assignments = uniqueById(allAssignments);

  // 리마인더 리스트 가져오기 (없으면 생성)
  let lists = await reminders.getLists();
  let videoList = lists.find(l => l.name === '동영상');
  let assignmentList = lists.find(l => l.name === '과제');
  if (!videoList) {
    const id = await reminders.createList({ name: '동영상' });
    videoList = await reminders.getList(id);
  }
  if (!assignmentList) {
    const id = await reminders.createList({ name: '과제' });
    assignmentList = await reminders.getList(id);
  }

  // 기존 리마인더 id 목록 (name 앞의 [id]에서 추출, 없으면 name 전체)
  const videoReminders = await reminders.getReminders(videoList.id);
  const assignmentReminders = await reminders.getReminders(assignmentList.id);
  function extractIdFromName(name) {
    const m = name.match(/^\[(\d+)]/);
    return m ? m[1] : null;
  }
  const videoIdSet = new Set();
  const videoNameSet = new Set();
  for (const r of videoReminders) {
    const id = extractIdFromName(r.name);
    if (id) videoIdSet.add(id);
    else videoNameSet.add(r.name);
  }
  const assignmentIdSet = new Set();
  const assignmentNameSet = new Set();
  for (const r of assignmentReminders) {
    const id = extractIdFromName(r.name);
    if (id) assignmentIdSet.add(id);
    else assignmentNameSet.add(r.name);
  }

  // 날짜 파싱 및 리마인더 추가
  for (const v of videos) {
    if (!videoIdSet.has(v.id) && !videoNameSet.has(`[${v.id}] ` + (v.title || v.section))) {
      let dueDate = undefined;
      let dateSource = v.date || '';
      // 1. date에서 MM월DD일을 모두 찾아 마지막 항목을 dueDate로 사용
      if (dateSource) {
        const mmddRegex = /(\d{1,2})월(\d{1,2})일/g;
        let lastMatch;
        let match;
        while ((match = mmddRegex.exec(dateSource.replace(/\s/g, ''))) !== null) {
          lastMatch = match;
        }
        if (lastMatch) {
          const now = new Date();
          const year = now.getFullYear();
          const month = Number(lastMatch[1]) - 1;
          const day = Number(lastMatch[2]);
          dueDate = new Date(year, month, day);
        } else {
          // MM월DD일이 없으면 기존 연도 포함 날짜 파싱
          const rangeMatch = dateSource.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
          if (rangeMatch) {
            const [_, endYear, endMonth, endDay] = rangeMatch.slice(4, 7);
            dueDate = new Date(Number(endYear), Number(endMonth) - 1, Number(endDay));
          } else {
            const singleMatch = dateSource.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
            if (singleMatch) {
              const [_, year, month, day] = singleMatch;
              dueDate = new Date(Number(year), Number(month) - 1, Number(day));
            }
          }
        }
      }
      // 2. date에서 못 찾으면 name에서 마지막 MM월DD일 찾기
      if (!dueDate) {
        const nameText = (v.title || v.section || '').replace(/\s/g, '');
        const mmddRegex = /(\d{1,2})월(\d{1,2})일/g;
        let lastMatch;
        let match;
        while ((match = mmddRegex.exec(nameText)) !== null) {
          lastMatch = match;
        }
        if (lastMatch) {
          const now = new Date();
          const year = now.getFullYear();
          const month = Number(lastMatch[1]) - 1;
          const day = Number(lastMatch[2]);
          dueDate = new Date(year, month, day);
        }
      }
      let remindMeDate = undefined;
      if (dueDate) {
        remindMeDate = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
      }
      await reminders.createReminder(videoList.id, {
        name: `[${v.id}] ` + (v.title || v.section),
        body: (v.link ? v.link + '\n' : '') + (v.desc || v.date || ''),
        ...(dueDate ? { dueDate } : {}),
        ...(remindMeDate ? { remindMeDate } : {})
      });
    }
  }
  for (const a of assignments) {
    if (!assignmentIdSet.has(a.id) && !assignmentNameSet.has(`[${a.id}] ` + (a.title || a.section))) {
      let dueDate = undefined;
      let dateSource = a.date || '';
      // 1. date에서 MM월DD일을 모두 찾아 마지막 항목을 dueDate로 사용
      if (dateSource) {
        const mmddRegex = /(\d{1,2})월(\d{1,2})일/g;
        let lastMatch;
        let match;
        while ((match = mmddRegex.exec(dateSource.replace(/\s/g, ''))) !== null) {
          lastMatch = match;
        }
        if (lastMatch) {
          const now = new Date();
          const year = now.getFullYear();
          const month = Number(lastMatch[1]) - 1;
          const day = Number(lastMatch[2]);
          dueDate = new Date(year, month, day);
        } else {
          // MM월DD일이 없으면 기존 연도 포함 날짜 파싱
          const rangeMatch = dateSource.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
          if (rangeMatch) {
            const [_, endYear, endMonth, endDay] = rangeMatch.slice(4, 7);
            dueDate = new Date(Number(endYear), Number(endMonth) - 1, Number(endDay));
          } else {
            const singleMatch = dateSource.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
            if (singleMatch) {
              const [_, year, month, day] = singleMatch;
              dueDate = new Date(Number(year), Number(month) - 1, Number(day));
            }
          }
        }
      }
      // 2. date에서 못 찾으면 name에서 마지막 MM월DD일 찾기
      if (!dueDate) {
        const nameText = (a.title || a.section || '').replace(/\s/g, '');
        const mmddRegex = /(\d{1,2})월(\d{1,2})일/g;
        let lastMatch;
        let match;
        while ((match = mmddRegex.exec(nameText)) !== null) {
          lastMatch = match;
        }
        if (lastMatch) {
          const now = new Date();
          const year = now.getFullYear();
          const month = Number(lastMatch[1]) - 1;
          const day = Number(lastMatch[2]);
          dueDate = new Date(year, month, day);
        }
      }
      let remindMeDate = undefined;
      if (dueDate) {
        remindMeDate = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
      }
      await reminders.createReminder(assignmentList.id, {
        name: `[${a.id}] ` + (a.title || a.section),
        body: (a.link ? a.link + '\n' : '') + (a.desc || a.date || ''),
        ...(dueDate ? { dueDate } : {}),
        ...(remindMeDate ? { remindMeDate } : {})
      });
    }
  }

  console.log('모든 콘텐츠가 리마인더에 중복 없이 추가되었습니다.');
}

addAllContentsToReminders();
