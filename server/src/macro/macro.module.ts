import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MacroController } from './macro.controller';
import { App } from 'shared';
import { MacroService } from './macro.service';
import { UserService } from 'services/user.service';
@Module({
  controllers: [MacroController],
  providers: [MacroService, UserService],
})
export class MacroModule {
  constructor(private userService: UserService) {}
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(async (req, res, next) => {
        await this.userService.checkAuthorization(req.cookies.t, App.mf);
        next();
      })
      .forRoutes({
        path: '/rest/macro',
        method: RequestMethod.ALL,
      });
  }
}
