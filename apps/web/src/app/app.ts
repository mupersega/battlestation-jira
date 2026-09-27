import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Api } from './core/api';
import { Look } from './core/look';

/** The frame: the whole window, the mock notice when it applies, and whichever view is routed. */
@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly api = inject(Api);
  // Applies the remembered theme to the root element from the first frame.
  protected readonly look = inject(Look);
}
