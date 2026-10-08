module.exports = {
  apply(ctx) {
    ctx.registerService('crawlerService', {
      async fetchAccountData(platform, accountId) {
        return { platform, accountId, followers: 10000 };
      },
    });

    ctx.on('trigger-all-spiders', () => {
      ctx.logger.info('收到全局广播，开始批量执行爬虫任务...');
    });
  },
};
