/**
 * 我的和子页面 e2e（pnpm e2e:flows:me）：设置写回账号、改昵称、改密码、退出所有设备、同意书可选项、问题反馈、徽章、退出登录。
 * 写操作都用真实接口拦截，看请求体对不对；失败时不假装成功。
 */
import { ME, PROGRESS, SETTINGS, apiError, bodyText, jsonResponse, noOverflow, routeApi, startE2E, tap, visible } from './e2eKit.mjs'

const { check, newPage, goto, scenario, finish } = await startE2E('flows-me')
const posted = (calls, method, suffix) => calls.filter((c) => c.method === method && c.pathname.endsWith(suffix)).map((c) => JSON.parse(c.postData || '{}'))

await scenario('资料卡和设置写回账号', async () => {
  const { context, page } = await newPage()
  let settings = { ...SETTINGS }
  const calls = await routeApi(page, {
    'GET /student/settings': () => jsonResponse(settings),
    'PATCH /student/settings': (request) => {
      settings = { ...settings, ...request.postDataJSON() }
      return jsonResponse(settings)
    },
    'GET /student/progress': () => jsonResponse({ ...PROGRESS, dailyGoal: settings.dailyGoal }),
  })
  await goto(page, '/pages/me/index?api=real')
  await visible(page, 'me-stats')
  check('显示昵称和班级', (await page.getByTestId('me-name').innerText()) === '小明' && (await page.getByTestId('me-class').first().innerText()).includes('高一'))
  check('学习天数、经验、徽章来自进度', (await page.getByTestId('me-stat-days').innerText()) === '2' && (await page.getByTestId('me-stat-xp').innerText()) === '40' && (await page.getByTestId('me-stat-badges').innerText()) === '1')
  check('不显示匿名编号', !(await bodyText(page)).includes(ME.anonCode))

  await tap(page, 'me-goal-5')
  await page.waitForFunction(() => document.querySelector('[data-testid="me-goal-5"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 5000 })
  check('每日目标写到账号', posted(calls, 'PATCH', '/student/settings').some((b) => b.dailyGoal === 5))
  await tap(page, 'me-input-keyboard')
  check('默认输入写到账号', await page.waitForFunction(() => true).then(() => posted(calls, 'PATCH', '/student/settings').some((b) => b.defaultInput === 'keyboard')))
  await tap(page, 'me-theme-dark')
  check('外观立刻生效', (await page.locator('html').getAttribute('data-theme')) === 'dark')
  await page.waitForTimeout(100)
  check('外观写到账号', posted(calls, 'PATCH', '/student/settings').some((b) => b.theme === 'dark'))
  await tap(page, 'me-pref-sound')
  await page.waitForTimeout(100)
  check('手感开关写到账号', posted(calls, 'PATCH', '/student/settings').some((b) => b.sound === false))
  await context.close()
})

await scenario('设置写失败：说实话，本机仍生效', async () => {
  const { context, page } = await newPage()
  await routeApi(page, { 'PATCH /student/settings': () => apiError(500, 'INTERNAL', '服务暂时不可用') })
  await goto(page, '/pages/me/index?api=real')
  await visible(page, 'me-page')
  await tap(page, 'me-theme-dark')
  await page.getByText('没保存到账号').first().waitFor({ state: 'visible', timeout: 5000 })
  check('提示没存到账号，这台设备上已生效', (await page.locator('html').getAttribute('data-theme')) === 'dark')
  await context.close()
})

await scenario('改昵称', async () => {
  const { context, page } = await newPage()
  let attempt = 0
  let settings = { ...SETTINGS }
  const calls = await routeApi(page, {
    'GET /student/settings': () => jsonResponse(settings),
    'PATCH /student/settings': (request) => {
      attempt += 1
      if (attempt === 1) return apiError(422, 'VALIDATION_FAILED', '昵称不能超过 16 个字')
      settings = { ...settings, ...request.postDataJSON() }
      return jsonResponse(settings)
    },
  })
  await goto(page, '/pages/me/index?api=real')
  await visible(page, 'me-name')
  await tap(page, 'me-edit-name')
  await visible(page, 'me-name-sheet')
  const input = page.getByTestId('me-name-input').locator('input')
  check('输入框里是现在的昵称', (await input.inputValue()) === '小明')
  await input.fill('   ')
  await tap(page, 'me-name-save')
  await page.getByText('昵称不能是空的').waitFor({ state: 'visible', timeout: 3000 })
  check('空昵称不发请求', posted(calls, 'PATCH', '/student/settings').length === 0)
  await input.fill('小红')
  await tap(page, 'me-name-save')
  await page.getByText('昵称不能超过 16 个字').waitFor({ state: 'visible', timeout: 5000 })
  check('服务端拒绝：原因留在弹层，昵称不变', (await page.getByTestId('me-name-sheet').isVisible()) && (await page.getByTestId('me-name').innerText()) === '小明')
  await tap(page, 'me-name-save')
  await page.getByTestId('me-name-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  check('成功后资料卡更新', (await page.getByTestId('me-name').innerText()) === '小红')
  check('请求体只带昵称', posted(calls, 'PATCH', '/student/settings').at(-1).nickname === '小红')
  await context.close()
})

await scenario('入口都能到', async () => {
  const { context, page } = await newPage()
  await goto(page, '/pages/me/index')
  await visible(page, 'me-page')
  for (const [row, marker] of [
    ['me-badges', 'badges-page'],
    ['me-row-account', 'account-page'],
    ['me-row-privacy', 'privacy-page'],
    ['me-row-about', 'about-page'],
  ]) {
    await tap(page, row)
    await visible(page, marker)
    check(row + ' 到 ' + marker, true)
    await tap(page, 'me-sub-back')
    await visible(page, 'me-page')
  }
  await tap(page, 'me-row-feedback')
  await visible(page, 'feedback-sheet')
  check('问题反馈直接打开弹层', page.url().includes('feedback=1'))
  await page.keyboard.press('Escape')
  await tap(page, 'me-sub-back')
  await visible(page, 'me-page')
  await tap(page, 'me-replay-onboarding')
  await visible(page, 'welcome-page')
  check('重看引导去欢迎页', page.url().includes('replay=1'), page.url())
  await context.close()
})

await scenario('改密码', async () => {
  const { context, page } = await newPage()
  let attempt = 0
  const calls = await routeApi(page, {
    'POST /auth/student/password': () => {
      attempt += 1
      return attempt === 1 ? apiError(403, 'INVALID_CREDENTIALS', '当前密码不对') : jsonResponse({ ok: true })
    },
  })
  await goto(page, '/pages/me/account?api=real')
  await visible(page, 'account-page')
  const fill = (id, value) => page.getByTestId(id).locator('input').fill(value)

  await tap(page, 'account-save')
  await page.getByText('请先输入当前密码').waitFor({ state: 'visible', timeout: 3000 })
  await fill('account-current', 'old-password')
  await fill('account-next', 'new-password-1')
  await fill('account-confirm', 'different')
  await tap(page, 'account-save')
  await page.getByText('两次输入的密码不一样').waitFor({ state: 'visible', timeout: 3000 })
  check('前端校验拦下，不发请求', posted(calls, 'POST', '/auth/student/password').length === 0)

  await fill('account-confirm', 'new-password-1')
  await tap(page, 'account-save')
  await visible(page, 'account-error')
  check('当前密码不对：显示服务端原因', (await page.getByTestId('account-error').innerText()).includes('当前密码不对'))
  check('失败时输入还在', (await page.getByTestId('account-next').locator('input').inputValue()) === 'new-password-1')

  await tap(page, 'account-save')
  await page.getByText('密码改好了').waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(() => ['account-current', 'account-next', 'account-confirm'].every((id) => document.querySelector('[data-testid="' + id + '"] input')?.value === ''), null, { timeout: 3000 })
  check('成功：三个输入都清空', true)
  const body = posted(calls, 'POST', '/auth/student/password').at(-1)
  check('请求体带新旧密码', body.newPassword === 'new-password-1' && body.currentPassword === 'old-password')
  check('按钮至少 44px', (await page.getByTestId('account-save').boundingBox()).height >= 44)
  await context.close()
})

await scenario('退出所有设备', async () => {
  const { context, page } = await newPage()
  // 退出之后服务端不再认这个会话：登录页问 /me 得到 401，才会留在登录页。
  let signedOut = false
  const calls = await routeApi(page, {
    'GET /me': () => (signedOut ? apiError(401, 'UNAUTHENTICATED', '请重新登录') : jsonResponse(ME)),
    'POST /auth/logout-all': () => {
      signedOut = true
      return { status: 204, body: '' }
    },
  })
  await goto(page, '/pages/me/account?api=real')
  await visible(page, 'account-page')
  await tap(page, 'account-logout-all')
  await tap(page, 'account-logout-all-cancel')
  check('取消不发请求', posted(calls, 'POST', '/auth/logout-all').length === 0)
  await tap(page, 'account-logout-all')
  await tap(page, 'account-logout-all-confirm')
  await visible(page, 'login-submit') // 登录页是首页面，地址是 #/，不能靠 URL 判断
  check('确认后退出并回登录页', calls.some((c) => c.method === 'POST' && c.pathname.endsWith('/auth/logout-all')))
  await context.close()
})

await scenario('同意书', async () => {
  const { context, page } = await newPage()
  const section = (key, required) => ({ key, title: key + ' 标题', body: key + ' 全文', required })
  const doc = {
    version: '2026.11-1',
    sections: [section('service', true), section('crossBorderHosting', true), section('monitoring', true), section('crossBorderModel', false), section('research', false), section('guardianNotice', false)],
    signed: { version: '2026.11-1', signedAt: '2026-11-01T08:00:00.000Z', items: { service: true, crossBorderHosting: true, monitoring: true, crossBorderModel: false, research: true } },
  }
  let reject = true
  const calls = await routeApi(page, {
    'GET /consents': () => jsonResponse(doc),
    'POST /consents': () => (reject ? apiError(500, 'INTERNAL', '服务暂时不可用') : jsonResponse(ME)),
  })
  await goto(page, '/pages/me/privacy?api=real')
  await visible(page, 'privacy-version')
  check('显示签过的版本和日期', (await page.getByTestId('privacy-version').innerText()).includes('2026-11-01'))
  check('必选项没有开关', (await page.locator('[data-key="service"] [role="switch"]').count()) === 0 && (await page.locator('[data-key="service"] [data-testid="privacy-required"]').count()) === 1)
  check('监护人说明只读', (await page.locator('[data-key="guardianNotice"] [role="switch"]').count()) === 0 && (await page.locator('[data-key="guardianNotice"] [data-testid="privacy-readonly"]').count()) === 1)
  const research = page.getByTestId('privacy-switch-research')
  check('可选项显示已签的状态', (await research.getAttribute('aria-checked')) === 'true')

  await research.click()
  await page.getByText('没有改成功').first().waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="privacy-switch-research"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 3000 })
  check('失败：开关退回去，并提示', true)

  reject = false
  await research.click()
  await page.getByText('已更新').first().waitFor({ state: 'visible', timeout: 5000 })
  const body = posted(calls, 'POST', '/consents').at(-1)
  check('撤回可选项：五个键都提交，版本一致', body.version === '2026.11-1' && body.items.research === false && body.items.service === true && Object.keys(body.items).length === 5, JSON.stringify(body))
  check('监护人说明不参与签署', !('guardianNotice' in body.items))

  await page.locator('[data-key="service"] .pg-fold__head').click()
  check('展开能看全文', (await page.locator('[data-key="service"]').innerText()).includes('service 全文'))
  await context.close()
})

await scenario('关于和反馈', async () => {
  const { context, page } = await newPage()
  let attempt = 0
  const calls = await routeApi(page, { 'POST /student/feedback': () => (++attempt === 1 ? apiError(500, 'INTERNAL', '服务暂时不可用') : { status: 204, body: '' }) })
  await goto(page, '/pages/me/about?api=real')
  await visible(page, 'about-page')
  check('显示版本号', /\d+\.\d+/.test(await page.getByTestId('about-version').innerText()))
  check('有 AI 使用说明', (await page.getByTestId('about-ai').innerText()).includes('不替你写证明'))
  await tap(page, 'about-feedback')
  await visible(page, 'feedback-sheet')
  await tap(page, 'feedback-send')
  await visible(page, 'feedback-error')
  check('空内容不发', posted(calls, 'POST', '/student/feedback').length === 0)
  await tap(page, 'feedback-kind-idea')
  await page.getByTestId('feedback-body').locator('textarea').fill('  路径很好看  ')
  await tap(page, 'feedback-send')
  await page.waitForFunction(() => document.querySelector('[data-testid="feedback-error"]')?.innerText?.includes('服务暂时不可用'), null, { timeout: 8000 })
  check('发送失败：内容还在，原因写出来', (await page.getByTestId('feedback-body').locator('textarea').inputValue()).includes('路径很好看'))
  await tap(page, 'feedback-send')
  await page.getByTestId('feedback-sheet').waitFor({ state: 'hidden', timeout: 5000 })
  const body = posted(calls, 'POST', '/student/feedback').at(-1)
  check('请求体：类型、去空白的内容、页面', body.kind === 'idea' && body.body === '路径很好看' && body.page === 'me/about', JSON.stringify(body))
  await context.close()
})

await scenario('徽章', async () => {
  const { context, page } = await newPage()
  await goto(page, '/pages/me/badges')
  await visible(page, 'badges-summary')
  const earned = await page.locator('[data-testid="badge-card"][data-earned="true"]').count()
  const locked = await page.locator('[data-testid="badge-card"][data-earned="false"]').count()
  check('拿到的和没拿到的都有', earned > 0 && locked > 0, earned + '/' + locked)
  check('拿到的排在前面', (await page.getByTestId('badge-card').first().getAttribute('data-earned')) === 'true')
  check('拿到的有日期', (await page.locator('[data-testid="badge-card"][data-earned="true"]').first().innerText()).includes('获得'))
  check('没拿到的有进度', (await page.locator('[data-testid="badge-card"][data-earned="false"]').first().innerText()).includes(' / '))
  await context.close()
})

await scenario('退出登录', async () => {
  const { context, page } = await newPage()
  await goto(page, '/pages/me/index')
  await tap(page, 'me-logout')
  await tap(page, 'me-logout-cancel')
  await page.getByTestId('me-logout-cancel').waitFor({ state: 'hidden', timeout: 5000 })
  check('取消留在我的', page.url().includes('/pages/me/index'))
  await tap(page, 'me-logout')
  await tap(page, 'me-logout-confirm')
  await visible(page, 'login-submit')
  check('确认后回登录页', true)
  await context.close()
})

await scenario('宽度', async () => {
  for (const route of ['/pages/me/index', '/pages/me/account', '/pages/me/privacy', '/pages/me/about', '/pages/me/badges']) {
    for (const width of [320, 390, 768, 1280]) {
      const { context, page } = await newPage({ width, height: 900 })
      await goto(page, route)
      await page.waitForTimeout(300)
      check(route + ' ' + width + ' 宽无横向滚动', await noOverflow(page))
      await context.close()
    }
  }
})

await finish()
